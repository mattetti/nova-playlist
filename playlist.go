package nova

import (
	"bytes"
	"encoding/gob"
	"fmt"
	"html/template"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	PlaylistDataPath = "./data"
)

var HTMLTmpl = `
<!DOCTYPE html>
<html>
<head>
    <title>Radio Nova {{.Name}} - Playlist</title>
    <link rel="stylesheet" type="text/css" href="playlist.css">
    <link href="https://fonts.googleapis.com/css2?family=Open+Sans&display=swap" rel="stylesheet">

		<!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>

    <!-- Core dependencies -->
		<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js"></script>
		<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js"></script>

		<!-- Lucide Icons (global version) -->
		<script src="https://unpkg.com/lucide@latest"></script>

    <!-- Error handling for script loading -->
    <script>
        window.addEventListener('error', function(e) {
            if (e.target.tagName === 'SCRIPT') {
                console.error('Failed to load script:', e.target.src);
            }
        }, true);
    </script>
</head>
<body>
    <h1>Radio Nova {{.Title}}</h1>
    <nav>
        {{ .PrevLink | unescapeHTML }}
        <a href="./">All Playlists</a>
        {{ .NextLink | unescapeHTML }}
    </nav>

    <table class="playlist">
        <tbody class="playlist">
            {{$playlist := .}}
            {{range $index, $track := .Tracks}}
            {{$previousRanking := $playlist.PreviousRanking $track}}
            <tr class="playlist-entry" data-title="{{.Title}}">
                <td class="position"><span>{{addOne $index}}</span></td>
                <td class="rankinkDelta">
                {{if gt $previousRanking -1}}
                    {{ rankingDelta $index $previousRanking }}</span>
                {{ end }}
                </td>
                <td class="artwork">
                    <a href="{{.YTMusicURL}}" target="_blank"><img src="{{.ThumbURL}}" class="artwork" loading="lazy" /></a>
                </td>
                <td class="track">
                    <a href="{{.YTMusicURL}}" target="_blank"><span class="title">{{.Title}}</span></a>
                    by <a href="{{.YTPrimaryArtistURL}}" target="_blank"><span class="artist-name">{{.Artist}}</span></a>
                </td>
                <td class="duration">
                    <span class="duration">{{.YTDuration}}</span>
                </td>
                <td class="dsp-links">
                    <a class="ytmusic" href="{{.YTMusicURL}}" target="_blank"><img src="images/youtube-music.svg"/></a>
                    <a class="spotify" href="{{.SpotifyURL}}" target="_blank"><img src="images/spotify.svg"/></a>
                </td>
                <td class="playcount" data-count={{.Count}}>
                {{if gt .Count 20}}
                    <img src="images/flame-icon.svg" alt="{{.Count}} plays"/>
                {{end}}
                </td>
            </tr>
            {{end}}
        </tbody>
    </table>

    <!-- Nova Player Component -->
		<div id="nova-player-root"></div>

    <!-- Initialize YouTube IFrame API -->
    <script src="https://www.youtube.com/iframe_api"></script>

    <!-- Add NovaPlayer Component -->
    <script src="nova-player.js"></script>
</body>
</html>
`

type Playlist struct {
	Tracks           []*Track
	Name             string
	Month            int
	Year             int
	Day              int
	PreviousPlaylist *Playlist
	NextPlaylist     *Playlist
	YearlyPlaylist   bool
}

func (p *Playlist) Sort() {
	sort.Slice(p.Tracks, func(i, j int) bool {
		return p.Tracks[i].Count > p.Tracks[j].Count
	})
}

func (p *Playlist) Deduped() []*Track {
	uniques := map[string]*Track{}
	var key string
	for _, track := range p.Tracks {
		key = track.Key()
		// if the track is already in the map, it's a duplicate
		t, ok := uniques[key]
		if ok {
			uniques[key].Count++
		} else {
			t = &Track{Artist: track.Artist,
				Title:      track.Title,
				ImgURL:     track.ImgURL,
				SpotifyURL: track.SpotifyURL,
				Count:      1,
			}
			uniques[key] = t
		}
	}
	uniqueTracks := make([]*Track, 0, len(uniques))
	for _, track := range uniques {
		uniqueTracks = append(uniqueTracks, track)
	}
	// sort unique tracks by count
	sort.Slice(uniqueTracks, func(i, j int) bool {
		return uniqueTracks[i].Count > uniqueTracks[j].Count
	})
	return uniqueTracks
}

func (p *Playlist) String() string {
	// use a string builder to avoid creating a new string for each track
	var s strings.Builder
	s.WriteString(fmt.Sprintf("Playlist: date: %s\n", p.Name))
	for _, track := range p.Tracks {
		s.WriteString(fmt.Sprintf("%s : %s @ %d:%d\n", track.Artist, track.Title, track.Hour, track.Minute))
	}
	return s.String()
}

// the path in which the playlist can be saved/loaded from
func (p *Playlist) Path() string {
	if p.Name != "" {
		return PlaylistDataPath
	}
	path := PlaylistDataPath
	if p.Year > 0 {
		path = filepath.Join(path, fmt.Sprintf("%d", p.Year))
	}
	if p.Month > 0 {
		path = filepath.Join(path, fmt.Sprintf("%02d", p.Month))
	}
	return path
}

func (p *Playlist) Filename() string {
	filename := "playlist"
	if p == nil {
		return filename + ".gob"
	}
	// if the playlist has a name, use that as the filename
	if p.Name != "" {
		return filename + "-" + p.Name + ".gob"
	}

	if p.Year > 0 {
		filename = fmt.Sprintf("%s-%d", filename, p.Year)
	}
	if p.Month > 0 {
		filename = fmt.Sprintf("%s-%02d", filename, p.Month)
	}
	if p.Day > 0 {
		filename = fmt.Sprintf("%s-%02d", filename, p.Day)
	}
	return filename + ".gob"
}

func (p *Playlist) OldFilename() string {
	return fmt.Sprintf("playlist-%s.gob", p.Name)
}

func LoadPlaylistFromFile(filepath string) (*Playlist, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return nil, fmt.Errorf("failed to open the file %w", err)
	}
	defer file.Close()

	p := &Playlist{}

	// decode the file into playlist
	decoder := gob.NewDecoder(file)
	if err := decoder.Decode(p); err != nil {
		return nil, fmt.Errorf("failed to decode the binary file %w", err)
	}

	return p, nil
}

func (p *Playlist) LoadFromDisk() error {
	file, err := os.Open(filepath.Join(p.Path(), p.Filename()))
	if err != nil {
		return fmt.Errorf("failed to open the file from disk %w", err)
	}
	defer file.Close()

	// decode the file into playlist
	decoder := gob.NewDecoder(file)
	if err := decoder.Decode(p); err != nil {
		return fmt.Errorf("failed to decode the binary file %w", err)
	}

	return nil
}

func (p *Playlist) SaveToDisk() error {
	// path relative to this binary
	destPath := filepath.Join(p.Path(), p.Filename())
	fmt.Println("> saving playlist to", destPath)
	// check if directory exists
	dir := filepath.Dir(destPath)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		err = os.MkdirAll(dir, 0700)
		if err != nil {
			return fmt.Errorf("failed to make sure all directories were created - %w", err)
		}
	}

	file, err := os.Create(destPath)
	if err != nil {
		return fmt.Errorf("failed to create the file: %s - %w", destPath, err)
	}
	defer file.Close()

	encoder := gob.NewEncoder(file)
	if err := encoder.Encode(p); err != nil {
		return err
	}
	return nil
}

func (p *Playlist) PopulateYTIDs() error {
	for i, track := range p.Tracks {
		if track.YTMusicInfo == nil {
			track.YTMusicInfo = track.GetYTMusicInfo()
			p.Tracks[i] = track
		}
	}
	return nil
}

func (p *Playlist) AddTracks(tracks []*Track) {
	var found bool
	for _, trackToAdd := range tracks {
		for i, t := range p.Tracks {
			if t.Key() == trackToAdd.Key() {
				p.Tracks[i].Count++
				found = true
				break
			}
		}
		if !found {
			trackToAdd.Count = 1
			p.Tracks = append(p.Tracks, trackToAdd)
		}
	}
}

func (p *Playlist) Title() string {
	if p == nil {
		return ""
	}

	if p.Year > 0 && p.Month > 0 {
		return fmt.Sprintf("%s %d", MonthEnglishName(time.Month(p.Month)), p.Year)
	}

	return p.Name
}

func (p *Playlist) PreviousRanking(track *Track) int {
	if p == nil || p.PreviousPlaylist == nil {
		return -1
	}
	for i, t := range p.PreviousPlaylist.Tracks {
		if t.Key() == track.Key() {
			return i
		}
	}
	return -1
}

func (p *Playlist) ToHTML() ([]byte, error) {
	// TODO: check if we have a previous/next playlist
	// get the previous playlist to get the ranking changes
	t, err := template.New("playlist").Funcs(template.FuncMap{
		"addOne": func(n int) int {
			return n + 1
		},
		"unescapeHTML": func(s string) template.HTML {
			return template.HTML(s)
		},
		"minus": func(a, b int) int {
			return a - b
		},
		"rankingDelta": func(newPosition, oldPosition int) template.HTML {
			if oldPosition == -1 {
				return ""
			}
			if newPosition < oldPosition {
				diff := oldPosition - newPosition
				return template.HTML(fmt.Sprintf(`<div class="ranking-delta up">
  <svg xmlns="http://www.w3.org/2000/svg" height="48" width="48"><path class="arrow-up" d="m24 30-10-9.95h20Z"></path></svg>
  <span class="ranking-delta-num">%d</span>
</div>`, diff))
			} else {
				diff := newPosition - oldPosition
				return template.HTML(fmt.Sprintf(`<div class="ranking-delta down">
				<span class="ranking-delta-num">%d</span>
				<svg xmlns="http://www.w3.org/2000/svg" height="48" width="48"><path class="arrow-down" d="m24 30-10-9.95h20Z"></path></svg>
			</div>`, diff))
			}
		},
	}).Parse(HTMLTmpl)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	err = t.Execute(&buf, p)
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

func addOne(n int) int {
	return n + 1
}

func (p *Playlist) PrevLink() string {
	if p == nil || p.PreviousPlaylist == nil {
		return ""
	}

	return fmt.Sprintf(`<a href="%s" class="prev">%s</a>`, p.PreviousPlaylist.Name+".html", p.PreviousPlaylist.Title())
}

func (p *Playlist) NextLink() string {
	if p == nil || p.NextPlaylist == nil {
		return ""
	}

	return fmt.Sprintf(`<a href="%s" class="next">%s</a>`, p.NextPlaylist.Name+".html", p.NextPlaylist.Title())
}
