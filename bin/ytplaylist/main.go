package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/mattetti/nova-playlist"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/youtube/v3"
)

var (
	monthFlag        = flag.Int("month", 0, "the month to process (1-12)")
	yearFlag         = flag.Int("year", 0, "the year to process (if no -month is provided, creates a yearly playlist; defaults to current year)")
	allFlag          = flag.Bool("all", false, "process all available playlists")
	privateFlag      = flag.Bool("private", true, "create private playlists (default true)")
	skipExistingFlag = flag.Bool("skip-existing", true, "skip if playlist already exists (default true)")
	forceFlag        = flag.Bool("force", false, "force re-creating or updating an existing playlist")
	credentialsFile  = flag.String("credentials", "client_secret.json", "path to OAuth2 credentials file")
	tokenFile        = flag.String("token", "token.json", "path to OAuth2 token file")
	limitFlag        = flag.Int("limit", 100, "limit the number of songs per playlist (default 100)")
)

type PlaylistCreator struct {
	service   *youtube.Service
	private   bool
	quotaUsed int
}

const (
	QuotaCreatePlaylist = 50
	QuotaAddTrack       = 50
	DailyQuotaLimit     = 10000
)

// getClient retrieves a token (from file or web) and returns the HTTP client.
func getClient(config *oauth2.Config, tokenFile string) (*http.Client, error) {
	tok, err := tokenFromFile(tokenFile)
	if err != nil {
		tok, err = getTokenFromWeb(config)
		if err != nil {
			return nil, err
		}
		if err := saveToken(tokenFile, tok); err != nil {
			return nil, err
		}
	}
	return config.Client(context.Background(), tok), nil
}

// getTokenFromWeb starts a local server on :8080 to handle the OAuth callback.
func getTokenFromWeb(config *oauth2.Config) (*oauth2.Token, error) {
	log.Printf("OAuth2 Config:\n  ClientID: %s\n  RedirectURL: %s\n  Scopes: %v",
		config.ClientID, config.RedirectURL, config.Scopes)

	if config.RedirectURL != "http://localhost:8080" {
		return nil, fmt.Errorf("redirect URL mismatch: expected http://localhost:8080, got %s", config.RedirectURL)
	}

	codeCh := make(chan string)
	srv := &http.Server{Addr: ":8080"}
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		code := r.URL.Query().Get("code")
		if code == "" {
			http.Error(w, "Missing 'code' in query params", http.StatusBadRequest)
			return
		}
		fmt.Fprintln(w, "Authorization received; you can close this tab.")
		codeCh <- code
	})

	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe error: %v", err)
		}
	}()

	authURL := config.AuthCodeURL("state-token", oauth2.AccessTypeOffline)
	fmt.Printf("Authorize the application by visiting:\n%v\n", authURL)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	code := <-codeCh

	serverClosed := make(chan struct{})
	go func() {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("Server shutdown failed: %v", err)
		}
		close(serverClosed)
	}()

	select {
	case <-serverClosed:
		log.Printf("Server shutdown completed")
	case <-shutdownCtx.Done():
		log.Printf("Server shutdown timed out")
	}

	tok, err := config.Exchange(context.Background(), code)
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve token from web: %v", err)
	}
	return tok, nil
}

// tokenFromFile retrieves a token from a local file.
func tokenFromFile(file string) (*oauth2.Token, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	tok := &oauth2.Token{}
	err = json.NewDecoder(f).Decode(tok)
	return tok, err
}

// saveToken saves a token to the specified file.
func saveToken(path string, token *oauth2.Token) error {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("unable to cache OAuth token: %v", err)
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(token)
}

// NewPlaylistCreator creates a new PlaylistCreator by reading credentials and setting up OAuth.
func NewPlaylistCreator(credentialsFile string, tokenFile string, private bool) (*PlaylistCreator, error) {
	ctx := context.Background()
	b, err := os.ReadFile(credentialsFile)
	if err != nil {
		return nil, fmt.Errorf("unable to read client secret file: %v", err)
	}

	var credsJSON map[string]interface{}
	if err := json.Unmarshal(b, &credsJSON); err == nil {
		if web, ok := credsJSON["web"].(map[string]interface{}); ok {
			log.Printf("Credentials file contains web config with redirect_uris: %v", web["redirect_uris"])
		}
	}

	config, err := google.ConfigFromJSON(b, youtube.YoutubeScope)
	if err != nil {
		return nil, fmt.Errorf("unable to parse client secret file to config: %v", err)
	}

	log.Printf("Created OAuth2 config with redirect URI: %s", config.RedirectURL)

	client, err := getClient(config, tokenFile)
	if err != nil {
		return nil, fmt.Errorf("unable to get client: %v", err)
	}

	service, err := youtube.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("error creating YouTube service: %v", err)
	}

	return &PlaylistCreator{
		service: service,
		private: private,
	}, nil
}

// savePlaylistTitle appends the created playlist title to a local cache file.
func savePlaylistTitle(title string) error {
	f, err := os.OpenFile("playlist_cache.txt", os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	if _, err := f.WriteString(title + "\n"); err != nil {
		return err
	}
	return nil
}

// checkIfExists returns true if the playlist title already exists in the cache.
func (pc *PlaylistCreator) checkIfExists(title string) (bool, error) {
	content, err := os.ReadFile("playlist_cache.txt")
	if err != nil {
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}

	titles := strings.Split(string(content), "\n")
	for _, t := range titles {
		if strings.EqualFold(strings.TrimSpace(t), title) {
			return true, nil
		}
	}
	return false, nil
}

// findPlaylistByTitle searches for an existing playlist by title using the YouTube API.
func (pc *PlaylistCreator) findPlaylistByTitle(title string) (string, error) {
	call := pc.service.Playlists.List([]string{"snippet"}).Mine(true)
	response, err := call.Do()
	if err != nil {
		return "", fmt.Errorf("error listing playlists: %v", err)
	}
	for _, playlist := range response.Items {
		if playlist.Snippet != nil && playlist.Snippet.Title == title {
			return playlist.Id, nil
		}
	}
	return "", nil
}

// addTracksToPlaylist adds tracks to an existing playlist identified by playlistID.
func (pc *PlaylistCreator) addTracksToPlaylist(playlistID string, tracks []*nova.Track) (string, error) {
	added := 0
	skipped := 0
	totalTracks := len(tracks)
	for i, track := range tracks {
		if pc.quotaUsed+QuotaAddTrack > DailyQuotaLimit {
			log.Printf("Stopping: quota limit reached. Added %d/%d tracks", added, totalTracks)
			break
		}
		if track.YTMusicInfo == nil || track.YTMusicInfo.VideoID == "" {
			skipped++
			log.Printf("Skipping track '%s - %s': no YouTube ID\n", track.Artist, track.Title)
			continue
		}
		playlistItem := &youtube.PlaylistItem{
			Snippet: &youtube.PlaylistItemSnippet{
				PlaylistId: playlistID,
				ResourceId: &youtube.ResourceId{
					Kind:    "youtube#video",
					VideoId: track.YTMusicInfo.VideoID,
				},
			},
		}
		pc.quotaUsed += QuotaAddTrack
		_, err := pc.service.PlaylistItems.Insert([]string{"snippet"}, playlistItem).Do()
		if err != nil {
			if strings.Contains(err.Error(), "quotaExceeded") {
				log.Printf("Quota exceeded after adding %d/%d tracks", added, totalTracks)
				break
			}
			skipped++
			log.Printf("Error adding video %s to playlist: %v\n", track.YTMusicInfo.VideoID, err)
			continue
		}
		added++
		if i%10 == 0 {
			log.Printf("Progress: %d/%d tracks added (quota used: %d/%d)", added, totalTracks, pc.quotaUsed, DailyQuotaLimit)
		}
		time.Sleep(500 * time.Millisecond)
	}
	log.Printf("Added %d tracks, skipped %d tracks (quota used: %d/%d)", added, skipped, pc.quotaUsed, DailyQuotaLimit)
	return fmt.Sprintf("https://music.youtube.com/playlist?list=%s", playlistID), nil
}

// CreatePlaylist creates a YouTube playlist from the provided nova.Playlist.
func (pc *PlaylistCreator) CreatePlaylist(novaPlaylist *nova.Playlist) (string, error) {
	if pc.quotaUsed+QuotaCreatePlaylist+QuotaAddTrack > DailyQuotaLimit {
		return "", fmt.Errorf("insufficient quota remaining: %d/%d used", pc.quotaUsed, DailyQuotaLimit)
	}

	var playlistTitle string
	playlistTitle = novaPlaylist.Title()

	if *skipExistingFlag && !*forceFlag {
		exists, err := pc.checkIfExists(playlistTitle)
		if err != nil {
			log.Printf("Warning: Could not check if playlist exists: %v", err)
		} else if exists {
			return "", fmt.Errorf("playlist already exists: %s", playlistTitle)
		}
	} else if *forceFlag {
		existingID, err := pc.findPlaylistByTitle(playlistTitle)
		if err != nil {
			log.Printf("Warning: could not search for existing playlist: %v", err)
		} else if existingID != "" {
			log.Printf("Found existing playlist with title %s, updating it", playlistTitle)
			return pc.addTracksToPlaylist(existingID, novaPlaylist.Tracks)
		}
	}

	privacyStatus := "public"
	if pc.private {
		privacyStatus = "private"
	}

	playlist := &youtube.Playlist{
		Snippet: &youtube.PlaylistSnippet{
			Title:       playlistTitle,
			Description: "Radio Nova Playlist generated using the most played songs",
		},
		Status: &youtube.PlaylistStatus{
			PrivacyStatus: privacyStatus,
		},
	}

	pc.quotaUsed += QuotaCreatePlaylist
	log.Printf("Creating playlist (quota used: %d/%d)", pc.quotaUsed, DailyQuotaLimit)

	call := pc.service.Playlists.Insert([]string{"snippet", "status"}, playlist)
	resp, err := call.Do()
	if err != nil {
		return "", fmt.Errorf("error creating playlist: %v", err)
	}

	if err := savePlaylistTitle(playlistTitle); err != nil {
		log.Printf("Warning: Could not save playlist title to cache: %v", err)
	}

	log.Printf("Created playlist: %s\n", playlistTitle)

	tracksToProcess := novaPlaylist.Tracks
	if *limitFlag > 0 && len(tracksToProcess) > *limitFlag {
		tracksToProcess = tracksToProcess[:*limitFlag]
	}

	added := 0
	skipped := 0
	totalTracks := len(tracksToProcess)

	for i, track := range tracksToProcess {
		if pc.quotaUsed+QuotaAddTrack > DailyQuotaLimit {
			log.Printf("Stopping: quota limit reached. Added %d/%d tracks", added, totalTracks)
			break
		}
		if track.YTMusicInfo == nil || track.YTMusicInfo.VideoID == "" {
			skipped++
			log.Printf("Skipping track '%s - %s': no YouTube ID\n", track.Artist, track.Title)
			continue
		}
		playlistItem := &youtube.PlaylistItem{
			Snippet: &youtube.PlaylistItemSnippet{
				PlaylistId: resp.Id,
				ResourceId: &youtube.ResourceId{
					Kind:    "youtube#video",
					VideoId: track.YTMusicInfo.VideoID,
				},
			},
		}
		pc.quotaUsed += QuotaAddTrack
		_, err := pc.service.PlaylistItems.Insert([]string{"snippet"}, playlistItem).Do()
		if err != nil {
			if strings.Contains(err.Error(), "quotaExceeded") {
				log.Printf("Quota exceeded after adding %d/%d tracks", added, totalTracks)
				break
			}
			skipped++
			log.Printf("Error adding video %s to playlist: %v\n", track.YTMusicInfo.VideoID, err)
			continue
		}
		added++
		if i%10 == 0 {
			log.Printf("Progress: %d/%d tracks added (quota used: %d/%d)",
				added, totalTracks, pc.quotaUsed, DailyQuotaLimit)
		}
		time.Sleep(500 * time.Millisecond)
	}

	log.Printf("Added %d tracks, skipped %d tracks (quota used: %d/%d)\n",
		added, skipped, pc.quotaUsed, DailyQuotaLimit)
	return fmt.Sprintf("https://music.youtube.com/playlist?list=%s", resp.Id), nil
}

// createYearlyPlaylist aggregates all monthly playlists for a given year,
// sums each track's play count, sorts tracks by total plays, selects the top 100,
// and creates or updates a YouTube playlist.
func createYearlyPlaylist(creator *PlaylistCreator, year int) (string, error) {
	files, err := os.ReadDir(nova.PlaylistDataPath)
	if err != nil {
		return "", fmt.Errorf("failed to read playlists directory: %v", err)
	}

	type TrackInfo struct {
		Track     nova.Track
		PlayCount int
	}
	trackMap := make(map[string]*TrackInfo)

	yearStr := fmt.Sprintf("-%d.gob", year)
	for _, file := range files {
		if !strings.HasPrefix(file.Name(), "playlist-") || !strings.HasSuffix(file.Name(), ".gob") {
			continue
		}
		// Check if the file name contains the year string (e.g. "-2024.gob")
		if !strings.Contains(file.Name(), yearStr) {
			continue
		}
		playlist, err := nova.LoadPlaylistFromFile(filepath.Join(nova.PlaylistDataPath, file.Name()))
		if err != nil {
			log.Printf("Warning: Could not load playlist %s: %v\n", file.Name(), err)
			continue
		}
		log.Printf("Processing file %s (playlist.Year=%d)", file.Name(), playlist.Year)
		for _, track := range playlist.Tracks {
			key := fmt.Sprintf("%s-%s", track.Artist, track.Title)
			if info, exists := trackMap[key]; exists {
				info.PlayCount += track.Count
			} else {
				trackMap[key] = &TrackInfo{Track: *track, PlayCount: track.Count}
			}
		}
	}

	var tracks []TrackInfo
	for _, info := range trackMap {
		tracks = append(tracks, *info)
	}

	sort.Slice(tracks, func(i, j int) bool {
		return tracks[i].PlayCount > tracks[j].PlayCount
	})

	yearlyPlaylist := &nova.Playlist{
		Year:           year,
		Tracks:         make([]*nova.Track, 0),
		YearlyPlaylist: true,
	}

	count := 0
	for _, info := range tracks {
		if count >= *limitFlag {
			break
		}
		yearlyPlaylist.Tracks = append(yearlyPlaylist.Tracks, &info.Track)
		count++
	}
	yearlyPlaylist.Name = fmt.Sprintf("Radio Nova - Most Played Songs of %d", year)

	if len(yearlyPlaylist.Tracks) == 0 {
		return "", fmt.Errorf("no tracks found for year %d", year)
	}

	return creator.CreatePlaylist(yearlyPlaylist)
}

// loadNovaPlaylist loads a monthly playlist file for the given year and month.
func loadNovaPlaylist(year, month int) (*nova.Playlist, error) {
	filename := fmt.Sprintf("playlist-%s-%d.gob", nova.MonthEnglishName(time.Month(month)), year)
	filepath := filepath.Join(nova.PlaylistDataPath, filename)
	playlist, err := nova.LoadPlaylistFromFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to load playlist %s: %v", filepath, err)
	}
	return playlist, nil
}

// loadAllPlaylists loads all monthly playlists from the data directory.
func loadAllPlaylists() ([]*nova.Playlist, error) {
	files, err := os.ReadDir(nova.PlaylistDataPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read playlists directory: %v", err)
	}

	var playlists []*nova.Playlist
	for _, file := range files {
		if file.IsDir() || !strings.HasPrefix(file.Name(), "playlist-") || !strings.HasSuffix(file.Name(), ".gob") {
			continue
		}

		playlist, err := nova.LoadPlaylistFromFile(filepath.Join(nova.PlaylistDataPath, file.Name()))
		if err != nil {
			log.Printf("Warning: Could not load playlist %s: %v\n", file.Name(), err)
			continue
		}
		playlists = append(playlists, playlist)
	}

	sort.Slice(playlists, func(i, j int) bool {
		if playlists[i].Year == playlists[j].Year {
			return playlists[i].Month < playlists[j].Month
		}
		return playlists[i].Year < playlists[j].Year
	})

	return playlists, nil
}

func main() {
	flag.Parse()

	absPath, err := filepath.Abs("./../../data")
	if err != nil {
		log.Fatalf("Failed to get absolute path for playlist data: %v", err)
	}
	nova.PlaylistDataPath = absPath

	creator, err := NewPlaylistCreator(*credentialsFile, *tokenFile, *privateFlag)
	if err != nil {
		log.Fatalf("Failed to create playlist creator: %v", err)
	}

	if *allFlag {
		playlists, err := loadAllPlaylists()
		if err != nil {
			log.Fatalf("Failed to load playlists: %v", err)
		}

		log.Printf("Found %d playlists to process\n", len(playlists))
		for _, playlist := range playlists {
			url, err := creator.CreatePlaylist(playlist)
			if err != nil {
				if *skipExistingFlag && strings.Contains(err.Error(), "playlist already exists") {
					log.Printf("Skipping %s: %v\n", playlist.Title(), err)
					continue
				}
				log.Printf("Error creating playlist for %s: %v\n", playlist.Title(), err)
				continue
			}
			log.Printf("Created playlist for %s: %s\n", playlist.Title(), url)
		}
		return
	}

	now := time.Now()
	year := *yearFlag
	if year == 0 {
		year = now.Year()
	}

	if *monthFlag != 0 {
		if *monthFlag < 1 || *monthFlag > 12 {
			log.Fatal("Month must be between 1 and 12")
		}
		playlist, err := loadNovaPlaylist(year, *monthFlag)
		if err != nil {
			log.Fatalf("Failed to load playlist: %v", err)
		}

		url, err := creator.CreatePlaylist(playlist)
		if err != nil {
			log.Fatalf("Failed to create playlist: %v", err)
		}

		fmt.Printf("Created playlist: %s\n", url)
		return
	}

	if flag.NFlag() > 0 {
		url, err := createYearlyPlaylist(creator, year)
		if err != nil {
			log.Fatalf("Failed to create yearly playlist: %v", err)
		}
		fmt.Printf("Created yearly playlist: %s\n", url)
		return
	}

	month := int(now.Month())
	playlist, err := loadNovaPlaylist(year, month)
	if err != nil {
		log.Fatalf("Failed to load playlist: %v", err)
	}

	url, err := creator.CreatePlaylist(playlist)
	if err != nil {
		log.Fatalf("Failed to create playlist: %v", err)
	}

	fmt.Printf("Created playlist: %s\n", url)
}
