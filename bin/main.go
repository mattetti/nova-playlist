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
		fmt.Printf("using last month (%s) by default\n", monthEnglishName(time.Month(*monthFlag)))
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

	dateStr := monthEnglishName(time.Month(month)) + "-" + strconv.Itoa(date.Year())
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
	} else {
		// load the playlist from disk
		if err := monthlyPlaylist.LoadFromDisk(); err != nil {
			fmt.Println("Error loading the playlist from disk:", err)
			fmt.Println("Run the program with the -fetch flag to fetch the historical data from the Radio Nova website")
			os.Exit(1)
		}
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

	htmlF, err := os.Create(filepath.Join("web", monthlyPlaylist.Name+".html"))
	if err != nil {
		log.Fatal(err)
	}
	defer htmlF.Close()
	data, err := monthlyPlaylist.ToHTML()
	if err != nil {
		log.Fatal(err)
	}
	htmlF.Write(data)

	index := &Index{}
	if err = index.SaveToDisk(); err != nil {
		log.Fatal(err)
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

func monthEnglishName(month time.Month) string {

	var monthName string
	switch month {
	case time.January:
		monthName = "January"
	case time.February:
		monthName = "February"
	case time.March:
		monthName = "March"
	case time.April:
		monthName = "April"
	case time.May:
		monthName = "May"
	case time.June:
		monthName = "June"
	case time.July:
		monthName = "July"
	case time.August:
		monthName = "August"
	case time.September:
		monthName = "September"
	case time.October:
		monthName = "October"
	case time.November:
		monthName = "November"
	case time.December:
		monthName = "December"
	default:
		monthName = "Unknown"
	}
	return monthName
}

type PlaylistFile struct {
	Year  string
	Month string
	Path  string
}
type Index struct {
	PlaylistFiles []*PlaylistFile
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
			<li><a href="{{.Path}}"> {{.Month}} {{.Year}}</a></li>
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
	files, err := filepath.Glob(filepath.Join("web", "*.html"))
	if err != nil {
		return err
	}

	for _, f := range files {
		filename := filepath.Base(f)
		if filename != "index.html" {
			segments := strings.Split(filename[:len(filename)-5], "-")
			idx.PlaylistFiles = append(idx.PlaylistFiles, &PlaylistFile{
				Month: segments[0],
				Year:  segments[1],
				Path:  filename,
			})
		}
	}

	// sort by year and month
	sort.Slice(idx.PlaylistFiles, func(i, j int) bool {
		year1, _ := strconv.Atoi(idx.PlaylistFiles[i].Year)
		year2, _ := strconv.Atoi(idx.PlaylistFiles[j].Year)
		if year1 == year2 {
			month1, _ := strconv.Atoi(idx.PlaylistFiles[i].Month)
			month2, _ := strconv.Atoi(idx.PlaylistFiles[j].Month)
			return month1 < month2
		}
		return year1 < year2
	})

	html, err := idx.ToHTML()
	if err != nil {
		return err
	}

	filename := filepath.Join("web", "index.html")
	return os.WriteFile(filename, html, os.ModePerm)
}
