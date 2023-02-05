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
)

var (
	PlaylistDataPath = "./data"
)

var HTMLTmpl = `
<!DOCTYPE html>
<html>
<head>
	<title>Radio Nova {{.Date}} - Playlist</title>
</head>
<body>
	<h1>Radio Nova {{.Date}} - Playlist</h1>
	<table>
		<thead>
			<tr>
				<th>#</th>
				<th>Track</th>
				<th>Artwork</th>
				<th>SpotifyURL</th>
				<th>Count</th>
			</tr>
		</thead>
		<tbody>
			{{range $index, $track := .Tracks}}
			<tr>
				<td>{{addOne $index}}</td>
				<td><a href="{{.YTMusicURL}}"> {{.Title}}</a>
				by <a href="{{.YTPrimaryArtistURL}}"> {{.Artist}}</a></td>
				<td><img src="{{.ThumbURL}}"/></td>
				<td><a href="{{.YTMusicURL}}">Play on YouTube Music</a></td>
				<td><a href="{{.SpotifyURL}}">Play on Spotify</a></td>
				<td>{{.Count}}</td>
			</tr>
			{{end}}
		</tbody>
	</table>
</body>
</html>
`

type Playlist struct {
	Tracks []*Track
	Date   string
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
	s.WriteString(fmt.Sprintf("Playlist: date: %s\n", p.Date))
	for _, track := range p.Tracks {
		s.WriteString(fmt.Sprintf("%s : %s @ %d:%d\n", track.Artist, track.Title, track.Hour, track.Minute))
	}
	return s.String()
}

func (p *Playlist) Filename() string {
	return fmt.Sprintf("playlist-%s.gob", p.Date)
}

func (p *Playlist) LoadFromDisk() error {
	file, err := os.Open(filepath.Join(PlaylistDataPath, p.Filename()))
	if err != nil {
		return err
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
	file, err := os.Create(filepath.Join(PlaylistDataPath, p.Filename()))
	if err != nil {
		return err
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

func (p *Playlist) ToHTML() ([]byte, error) {
	t, err := template.New("playlist").Funcs(template.FuncMap{
		"addOne": addOne,
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
