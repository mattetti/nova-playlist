package main

import (
	"bytes"
	"flag"
	"fmt"
	"html/template"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mattetti/nova-playlist"
)

var monthFlag = flag.Int("month", 0, "the month to process (e.g. 1 for January, 2 for February, etc)")
var fetchFlag = flag.Bool("fetch", false, "fetch the playlist from the Radio Nova website")
var genFlag = flag.Bool("gen", true, "generate the HTML page for the playlist")

func usage() {
	fmt.Fprintf(os.Stderr, "Usage of %s:\n", os.Args[0])
	flag.PrintDefaults()
}

func main() {
	flag.Usage = usage
	flag.Parse()

	createRequiredDirectories()

	date := time.Now().UTC()
	if *monthFlag <= 0 || *monthFlag > 12 {
		fmt.Println("Invalid month flag, please pass a number between 1 and 12")
		flag.Usage()
		*monthFlag = int(date.Month() - 1)
		fmt.Printf("using last month (%s) by default\n", nova.MonthEnglishName(time.Month(*monthFlag)))
	}

	month := *monthFlag
	date = time.Date(date.Year(), time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	if date.After(time.Now().UTC()) {
		date = time.Date(date.Year()-1, time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	}
	firstDayOfMonth := time.Date(date.Year(), time.Month(month), 1, 0, 0, 0, 0, time.UTC)
	lastDayOfMonth := time.Date(date.Year(), time.Month(month)+1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, 0, -1)
	if lastDayOfMonth.After(time.Now().UTC()) {
		lastDayOfMonth = time.Now().UTC()
	}

	dateStr := nova.MonthEnglishName(time.Month(month)) + "-" + strconv.Itoa(date.Year())
	monthlyPlaylist := nova.Playlist{
		Name:  dateStr,
		Year:  date.Year(),
		Month: int(date.Month()),
	}
	_, err := nova.LoadYTMusicCache()
	if err != nil {
		log.Fatal(fmt.Errorf("Failed to load the YT music cache - %w", err))
	}
	defer nova.YTMusic.Save()

	// if the user passed a -fetch flag, run the code, otherwise exit
	if *fetchFlag {
		var err error
		playlists, err := nova.GetPlaylists(firstDayOfMonth, lastDayOfMonth)
		if err != nil {
			log.Fatalf("Something went wrong trying to get the playlists from %s to %s - %v", firstDayOfMonth, lastDayOfMonth, err)
		}
		for _, playlist := range playlists {
			monthlyPlaylist.AddTracks(playlist.Tracks)
		}
		monthlyPlaylist.Sort()
		monthlyPlaylist.PopulateYTIDs()
		if err := monthlyPlaylist.SaveToDisk(); err != nil {
			log.Fatal(err)
		}
		fmt.Println()
		for i := 0; i < 100; i++ {
			track := monthlyPlaylist.Tracks[i]
			fmt.Printf("(%d) %s by %s  [%d] - %s\n", i+1, track.Title, track.Artist, track.Count, track.YTMusicURL())
		}
	}

	if *genFlag {
		// generate the HTML pages
		// look for all the playlists in the data directory
		files, err := os.ReadDir(nova.PlaylistDataPath)
		if err != nil {
			log.Fatal(fmt.Errorf("failed to read path %s - %v", nova.PlaylistDataPath, err))
		}
		index := &Index{Playlists: make(map[*nova.Playlist]string)}

		for _, file := range files {
			if file.IsDir() {
				continue
			}
			if !strings.HasPrefix(file.Name(), "playlist-") && !strings.HasSuffix(file.Name(), ".gob") {
				continue
			}
			playlist, err := nova.LoadPlaylistFromFile(filepath.Join(nova.PlaylistDataPath, file.Name()))
			if err != nil {
				log.Fatal(fmt.Errorf("failed to load playlist at path %s, %v", file.Name(), err))
			}
			fmt.Println("Playlist", playlist.Name, "loaded")
			htmlFilename := filepath.Join("web", playlist.Name+".html")
			htmlF, err := os.Create(htmlFilename)
			if err != nil {
				log.Fatal(err)
			}
			data, err := playlist.ToHTML()
			if err != nil {
				log.Fatal(err)
			}
			htmlF.Write(data)
			htmlF.Close()
			fmt.Println("Generated HTML file", htmlFilename)
			index.Playlists[playlist] = playlist.Name + ".html"
		}

		if err = index.SaveToDisk(); err != nil {
			log.Fatal(err)
		}
	}

}

func createRequiredDirectories() {
	// create the data directory if it doesn't exist
	if _, err := os.Stat(nova.PlaylistDataPath); os.IsNotExist(err) {
		if err := os.Mkdir(nova.PlaylistDataPath, 0755); err != nil {
			log.Fatal("Error creating the data directory:", err)
		}
	}

	if _, err := os.Stat("web"); os.IsNotExist(err) {
		if err := os.Mkdir("web", 0755); err != nil {
			log.Fatal("Error creating the web directory:", err)
		}
	}
}

type PlaylistFile struct {
	Year  int
	Month int
	Path  string
}

func (p *PlaylistFile) Title() string {
	return nova.MonthEnglishName(time.Month(p.Month)) + " " + strconv.Itoa(p.Year)
}

type Index struct {
	PlaylistFiles []*PlaylistFile
	Playlists     map[*nova.Playlist]string
}

var HTMLIndexTmpl = `
<!DOCTYPE html>
<html>
<head>
	<title>Radio Nova - Playlists</title>
	<link rel="stylesheet" type="text/css" href="playlist.css">
	<link href="https://fonts.googleapis.com/css2?family=Open+Sans&display=swap" rel="stylesheet">
</head>
<body>
	<h1>Radio Nova - Playlists</h1>
	<h2>Below are the monthly playlists of <a href="https://nova.fr" target="_blank">Radio Nova</a>.
	</h2>
		<ul id="playlists">
		{{range $index, $track := .PlaylistFiles}}
			<li><a href="{{.Path}}">{{.Title}}</a></li>
		{{end}}
		</ul>
</body>
</html>
`

func (idx *Index) ToHTML() ([]byte, error) {
	t, err := template.New("playlist").Funcs(template.FuncMap{}).Parse(HTMLIndexTmpl)
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	err = t.Execute(&buf, idx)
	if err != nil {
		return nil, err
	}

	return buf.Bytes(), nil
}

func (idx *Index) SaveToDisk() error {

	for playlist, path := range idx.Playlists {
		PlaylistFile := &PlaylistFile{
			Year:  playlist.Year,
			Month: playlist.Month,
			Path:  path,
		}
		idx.PlaylistFiles = append(idx.PlaylistFiles, PlaylistFile)
	}

	sort.Slice(idx.PlaylistFiles, func(i, j int) bool {
		if idx.PlaylistFiles[i].Year == idx.PlaylistFiles[j].Year {
			return idx.PlaylistFiles[i].Month > idx.PlaylistFiles[j].Month
		}
		return idx.PlaylistFiles[i].Year > idx.PlaylistFiles[j].Year
	})

	html, err := idx.ToHTML()
	if err != nil {
		return err
	}

	filename := filepath.Join("web", "index.html")
	return os.WriteFile(filename, html, os.ModePerm)
}
