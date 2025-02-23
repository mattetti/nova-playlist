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
	yearFlag         = flag.Int("year", 0, "the year to process (defaults to current year)")
	allFlag          = flag.Bool("all", false, "process all available playlists")
	privateFlag      = flag.Bool("private", true, "create private playlists (default true)")
	skipExistingFlag = flag.Bool("skip-existing", true, "skip if playlist already exists (default true)")
	credentialsFile  = flag.String("credentials", "client_secret.json", "path to OAuth2 credentials file")
	tokenFile        = flag.String("token", "token.json", "path to OAuth2 token file")
	yearlyFlag       = flag.Bool("yearly", false, "create a yearly playlist with top 100 most played songs")
	limitFlag        = flag.Int("limit", 100, "limit the number of songs per playlist (default 100)")
)

type PlaylistCreator struct {
	service   *youtube.Service
	private   bool
	quotaUsed int
}

// QuotaCost represents the quota points used by different API operations
const (
	QuotaCreatePlaylist = 50
	QuotaAddTrack       = 50
	DailyQuotaLimit     = 10000
)

// getClient retrieves a token, saves it, then returns the generated client.
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
	// Debug logging for OAuth2 configuration
	log.Printf("OAuth2 Config:\n  ClientID: %s\n  RedirectURL: %s\n  Scopes: %v",
		config.ClientID, config.RedirectURL, config.Scopes)

	// Ensure the redirect URI is correct
	if config.RedirectURL != "http://localhost:8080" {
		return nil, fmt.Errorf("redirect URL mismatch: expected http://localhost:8080, got %s",
			config.RedirectURL)
	}

	// A channel to receive the authorization code
	codeCh := make(chan string)

	// Start a simple server to catch the OAuth2 callback
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

	// Run the server in a goroutine
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("ListenAndServe error: %v", err)
		}
	}()

	// Generate the auth URL
	authURL := config.AuthCodeURL("state-token", oauth2.AccessTypeOffline)
	fmt.Printf("Authorize the application by visiting:\n%v\n", authURL)

	// Create a context with timeout for server shutdown
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Wait for the code from the callback
	code := <-codeCh

	// Create channel to signal server shutdown completion
	serverClosed := make(chan struct{})
	go func() {
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("Server shutdown failed: %v", err)
		}
		close(serverClosed)
	}()

	// Wait for server to shut down or timeout
	select {
	case <-serverClosed:
		log.Printf("Server shutdown completed")
	case <-shutdownCtx.Done():
		log.Printf("Server shutdown timed out")
	}

	// Exchange the code for a token
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

// saveToken saves a token to a file path.
func saveToken(path string, token *oauth2.Token) error {
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_TRUNC, 0600)
	if err != nil {
		return fmt.Errorf("unable to cache OAuth token: %v", err)
	}
	defer f.Close()
	return json.NewEncoder(f).Encode(token)
}

func NewPlaylistCreator(credentialsFile string, tokenFile string, private bool) (*PlaylistCreator, error) {
	ctx := context.Background()

	// Read the credentials file
	b, err := os.ReadFile(credentialsFile)
	if err != nil {
		return nil, fmt.Errorf("unable to read client secret file: %v", err)
	}

	// Log credentials file content (excluding secrets)
	var credsJSON map[string]interface{}
	if err := json.Unmarshal(b, &credsJSON); err == nil {
		if web, ok := credsJSON["web"].(map[string]interface{}); ok {
			log.Printf("Credentials file contains web config with redirect_uris: %v",
				web["redirect_uris"])
		}
	}

	// Configure OAuth2
	config, err := google.ConfigFromJSON(b, youtube.YoutubeScope)
	if err != nil {
		return nil, fmt.Errorf("unable to parse client secret file to config: %v", err)
	}

	// Log the created config
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

// savePlaylistTitle saves a created playlist title to a local cache file
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

// checkIfExists checks if a playlist title exists in the local cache
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

func createYearlyPlaylist(creator *PlaylistCreator, year int) (string, error) {
	// Load all playlists for the year
	files, err := os.ReadDir(nova.PlaylistDataPath)
	if err != nil {
		return "", fmt.Errorf("failed to read playlists directory: %v", err)
	}

	// Track frequency map
	type TrackInfo struct {
		Track     nova.Track
		PlayCount int
	}
	trackMap := make(map[string]*TrackInfo)

	// Process all monthly playlists for the year
	for _, file := range files {
		if !strings.HasPrefix(file.Name(), fmt.Sprintf("playlist-")) || !strings.HasSuffix(file.Name(), ".gob") {
			continue
		}

		playlist, err := nova.LoadPlaylistFromFile(filepath.Join(nova.PlaylistDataPath, file.Name()))
		if err != nil {
			log.Printf("Warning: Could not load playlist %s: %v\n", file.Name(), err)
			continue
		}

		// Only process playlists from the specified year
		if playlist.Year != year {
			continue
		}

		// Count occurrences of each track
		for _, track := range playlist.Tracks {
			key := fmt.Sprintf("%s-%s", track.Artist, track.Title)
			if info, exists := trackMap[key]; exists {
				info.PlayCount++
			} else {
				trackMap[key] = &TrackInfo{Track: *track, PlayCount: 1}
			}
		}
	}

	// Convert map to slice for sorting
	var tracks []TrackInfo
	for _, info := range trackMap {
		tracks = append(tracks, *info)
	}

	// Sort tracks by play count (descending)
	sort.Slice(tracks, func(i, j int) bool {
		return tracks[i].PlayCount > tracks[j].PlayCount
	})

	// Create new playlist with top 100 tracks
	yearlyPlaylist := &nova.Playlist{
		Year:   year,
		Tracks: make([]*nova.Track, 0),
	}

	// Take top 100 tracks
	count := 0
	for _, info := range tracks {
		if count >= 100 {
			break
		}
		yearlyPlaylist.Tracks = append(yearlyPlaylist.Tracks, &info.Track)
		count++
	}
	yearlyPlaylist.Name = fmt.Sprintf("Radio Nova - Top 100 of %d", year)

	return creator.CreatePlaylist(yearlyPlaylist)
}

func (pc *PlaylistCreator) CreatePlaylist(novaPlaylist *nova.Playlist) (string, error) {
	// Check if we have enough quota for minimum operations (create playlist + at least one track)
	if pc.quotaUsed+QuotaCreatePlaylist+QuotaAddTrack > DailyQuotaLimit {
		return "", fmt.Errorf("insufficient quota remaining: %d/%d used", pc.quotaUsed, DailyQuotaLimit)
	}

	// Determine playlist title based on type
	var playlistTitle string
	if strings.HasPrefix(novaPlaylist.Title(), "Top 100 of") {
		playlistTitle = fmt.Sprintf("Radio Nova - %s", novaPlaylist.Title())
	} else {
		playlistTitle = fmt.Sprintf("Radio Nova - %s", novaPlaylist.Title())
	}

	// Check if playlist already exists
	if *skipExistingFlag {
		exists, err := pc.checkIfExists(playlistTitle)
		if err != nil {
			log.Printf("Warning: Could not check if playlist exists: %v", err)
		} else if exists {
			return "", fmt.Errorf("playlist already exists: %s", playlistTitle)
		}
	}

	// Set privacy status
	privacyStatus := "public"
	if pc.private {
		privacyStatus = "private"
	}

	// Create playlist metadata
	playlist := &youtube.Playlist{
		Snippet: &youtube.PlaylistSnippet{
			Title:       playlistTitle,
			Description: fmt.Sprintf("Radio Nova playlist for %s. Generated automatically.", novaPlaylist.Title()),
		},
		Status: &youtube.PlaylistStatus{
			PrivacyStatus: privacyStatus,
		},
	}

	// Create the playlist
	pc.quotaUsed += QuotaCreatePlaylist
	log.Printf("Creating playlist (quota used: %d/%d)", pc.quotaUsed, DailyQuotaLimit)

	call := pc.service.Playlists.Insert([]string{"snippet", "status"}, playlist)
	resp, err := call.Do()
	if err != nil {
		return "", fmt.Errorf("error creating playlist: %v", err)
	}

	// Save the title to our local cache
	if err := savePlaylistTitle(playlistTitle); err != nil {
		log.Printf("Warning: Could not save playlist title to cache: %v", err)
	}

	log.Printf("Created playlist: %s\n", playlistTitle)

	// Prepare tracks for processing
	tracksToProcess := novaPlaylist.Tracks

	// Apply track limit if specified
	if *limitFlag > 0 && len(tracksToProcess) > *limitFlag {
		tracksToProcess = tracksToProcess[:*limitFlag]
	}

	// Add tracks to the playlist
	added := 0
	skipped := 0
	totalTracks := len(tracksToProcess)

	for i, track := range tracksToProcess {
		// Check quota before adding track
		if pc.quotaUsed+QuotaAddTrack > DailyQuotaLimit {
			log.Printf("Stopping: quota limit reached. Added %d/%d tracks", added, totalTracks)
			break
		}

		// Skip tracks without YouTube IDs
		if track.YTMusicInfo == nil || track.YTMusicInfo.VideoID == "" {
			skipped++
			log.Printf("Skipping track '%s - %s': no YouTube ID\n", track.Artist, track.Title)
			continue
		}

		// Create playlist item
		playlistItem := &youtube.PlaylistItem{
			Snippet: &youtube.PlaylistItemSnippet{
				PlaylistId: resp.Id,
				ResourceId: &youtube.ResourceId{
					Kind:    "youtube#video",
					VideoId: track.YTMusicInfo.VideoID,
				},
			},
		}

		// Add track to playlist
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

		// Log progress periodically
		if i%10 == 0 {
			log.Printf("Progress: %d/%d tracks added (quota used: %d/%d)",
				added, totalTracks, pc.quotaUsed, DailyQuotaLimit)
		}

		// Add delay between additions to avoid rate limiting
		time.Sleep(500 * time.Millisecond)
	}

	log.Printf("Added %d tracks, skipped %d tracks (quota used: %d/%d)\n",
		added, skipped, pc.quotaUsed, DailyQuotaLimit)

	return fmt.Sprintf("https://music.youtube.com/playlist?list=%s", resp.Id), nil
}

func loadNovaPlaylist(year, month int) (*nova.Playlist, error) {
	filename := fmt.Sprintf("playlist-%s-%d.gob",
		nova.MonthEnglishName(time.Month(month)), year)

	filepath := filepath.Join(nova.PlaylistDataPath, filename)
	playlist, err := nova.LoadPlaylistFromFile(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to load playlist %s: %v", filepath, err)
	}
	return playlist, nil
}

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

		playlist, err := nova.LoadPlaylistFromFile(
			filepath.Join(nova.PlaylistDataPath, file.Name()))
		if err != nil {
			log.Printf("Warning: Could not load playlist %s: %v\n", file.Name(), err)
			continue
		}
		playlists = append(playlists, playlist)
	}

	// Sort playlists by date
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

	creator, err := NewPlaylistCreator(*credentialsFile, *tokenFile, *privateFlag)
	if err != nil {
		log.Fatalf("Failed to create playlist creator: %v", err)
	}

	if *yearlyFlag {
		year := *yearFlag
		if year == 0 {
			year = time.Now().Year()
		}
		url, err := createYearlyPlaylist(creator, year)
		if err != nil {
			log.Fatalf("Failed to create yearly playlist: %v", err)
		}
		fmt.Printf("Created yearly playlist: %s\n", url)
		return
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

	// Process single month
	now := time.Now()
	year := *yearFlag
	if year == 0 {
		year = now.Year()
	}

	month := *monthFlag
	if month == 0 {
		month = int(now.Month())
	}

	if month < 1 || month > 12 {
		log.Fatal("Month must be between 1 and 12")
	}

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
