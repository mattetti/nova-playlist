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
	<link rel="stylesheet" type="text/css" href="playlist.css">
	<link href="https://fonts.googleapis.com/css2?family=Open+Sans&display=swap" rel="stylesheet">
</head>
<body>
	<h1>Radio Nova {{.Date}}</h1>
	<table>
		<thead>
			<tr>
				<th class="position">#</th>
				<th>Track</th>
				<th>Artwork</th>
				<th>Play</th>
				<th>Duration</th>
				<th>Play Count</th>
			</tr>
		</thead>
		<tbody>
			{{range $index, $track := .Tracks}}
			<tr class="playlist-entry">
				<td class="position">{{addOne $index}}</td>
				<td class="track"><a href="{{.YTMusicURL}}"  target="_blank"> {{.Title}}</a>
				by <a href="{{.YTPrimaryArtistURL}}"  target="_blank"> {{.Artist}}</a></td>
				<td class="artwork">
					<a href="{{.YTMusicURL}}" target="_blank"><img src="{{.ThumbURL}}" class="artwork" loading="lazy"/></a>
				</td>
				<td class="dsp-links">
					<a href="{{.YTMusicURL}}" target="_blank"><img src="images/youtube-music.svg"/></a>
					<a href="{{.SpotifyURL}}" target="_blank"><img src="images/spotify.svg"/></a> </td>
				<td class="duration">{{.YTDuration}}</td>
				<td class="playcount">{{.Count}}</td>
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
