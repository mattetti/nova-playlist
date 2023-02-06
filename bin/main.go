package main

import (
	"bytes"
	"flag"
	"fmt"
	"html/template"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
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

	dateStr := monthEnglishName(time.Month(month)) + "-" + strconv.Itoa(date.Year())
	globalPlaylist := nova.Playlist{Date: dateStr}

	// if the user passed a -fetch flag, run the code, otherwise exit
	if *fetchFlag {

		playlists := getPlaylists(firstDayOfMonth, lastDayOfMonth)
		for _, playlist := range playlists {
			globalPlaylist.AddTracks(playlist.Tracks)
		}
	} else {
		// load the playlist from disk
		if err := globalPlaylist.LoadFromDisk(); err != nil {
			fmt.Println("Error loading the playlist from disk:", err)
			fmt.Println("Run the program with the -fetch flag to fetch the historical data from the Radio Nova website")
			os.Exit(1)
		}
	}

	globalPlaylist.Sort()
	globalPlaylist.PopulateYTIDs()
	if err := globalPlaylist.SaveToDisk(); err != nil {
		log.Fatal(err)
	}

	fmt.Println()
	for i := 0; i < 100; i++ {
		track := globalPlaylist.Tracks[i]
		fmt.Printf("(%d) %s by %s  [%d] - %s\n", i+1, track.Title, track.Artist, track.Count, track.YTMusicURL())
	}

	htmlF, err := os.Create(filepath.Join("web", globalPlaylist.Date+".html"))
	if err != nil {
		log.Fatal(err)
	}
	defer htmlF.Close()
	data, err := globalPlaylist.ToHTML()
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

func getPlaylists(startDate, endDate time.Time) []*nova.Playlist {
	nonce, err := GetNonce()
	if err != nil {
		fmt.Println("Error getting the nonce:", err)
		log.Fatal(err)
	}
	var playlists []*nova.Playlist
	fmt.Println("Getting the playlists for", startDate.String(), "to", endDate.String())

	for date := startDate; date.Before(endDate); date = date.AddDate(0, 0, 1) {
		playlist := getPlaylist(date, nonce)
		playlists = append(playlists, playlist)
	}

	return playlists
}

func getPlaylist(date time.Time, nonce string) *nova.Playlist {
	t := date
	fmt.Println("Getting the playlist for", t.String())

	page := 0
	nbrItems := 99
	dDate := fmt.Sprintf("%d-%d-%d", t.Year(), t.Month(), t.Day())

	playlist := nova.Playlist{Date: dDate}
	err := playlist.LoadFromDisk()

	if err == nil {
		return &playlist
	}

	if nonce == "" {
		nonce, err = GetNonce()
		if err != nil {
			fmt.Println("Error getting the nonce:", err)
			log.Fatal(err)
		}
	}

	lastRequest := time.Now()
	for page < 100 && nbrItems > 0 {
		page++

		client := &http.Client{}

		dDate = fmt.Sprintf("%04d-%02d-%02d", t.Year(), t.Month(), t.Day())
		payload := "action=loadmore_programs"
		payload += "&afp_nonce=" + nonce
		payload += "&date=" + dDate
		payload += "&time=" + url.QueryEscape("23:59")
		payload += "&page=" + fmt.Sprintf("%d", page)
		payload += "&radio=910"

		body := strings.NewReader(payload)
		req, err := http.NewRequest("POST", "https://www.nova.fr/wp-admin/admin-ajax.php", body)
		if err != nil {
			fmt.Println("Error creating the request to nova.fr:")
			log.Fatal(err)
		}
		req.Header.Set("Authority", "www.nova.fr")
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Accept-Language", "fr-FR,fr;q=0.9")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
		req.Header.Set("Dnt", "1")
		req.Header.Set("Origin", "https://www.nova.fr")
		req.Header.Set("Referer", "https://www.nova.fr/c-etait-quoi-ce-titre/")
		req.Header.Set("Sec-Ch-Ua", "\"Not_A Brand\";v=\"99\", \"Google Chrome\";v=\"109\", \"Chromium\";v=\"109\"")
		req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
		req.Header.Set("Sec-Ch-Ua-Platform", "\"macOS\"")
		req.Header.Set("Sec-Fetch-Dest", "empty")
		req.Header.Set("Sec-Fetch-Mode", "cors")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")

		// wait 1 second between requests
		if time.Since(lastRequest) < 2*time.Second {
			fmt.Println(".")
			time.Sleep(time.Second - time.Since(lastRequest))
		}
		var resp *http.Response
		for _, backoff := range backoffSchedule {
			resp, err = client.Do(req)
			if err != nil {
				fmt.Println("Error getting the playlist from nova.fr, payload", payload)
				// print the response's body
				body, _ := ioutil.ReadAll(resp.Body)
				fmt.Println(string(body))
				fmt.Println("Waiting", backoff, "before retrying")
				time.Sleep(backoff)
				continue
			}

			defer resp.Body.Close()
			if resp.StatusCode != 200 {
				fmt.Println("Error getting the playlist from nova.fr, payload", payload)
				// print the response's body
				body, _ := ioutil.ReadAll(resp.Body)
				fmt.Println(string(body))
				fmt.Println("headers:")
				resp.Header.Write(os.Stdout)
				fmt.Printf("status code error: %d %s\n", resp.StatusCode, resp.Status)
				fmt.Println("Waiting", backoff, "before retrying")
				time.Sleep(backoff)
				continue
			}

			// no errors, no bad status code, we can stop the loop
			lastRequest = time.Now()
			break
		}

		if (resp == nil) || (resp.StatusCode != 200) {
			log.Fatalf("failed to retrieve playlist for %s, page %d\n", dDate, page)
		}

		doc, err := goquery.NewDocumentFromReader(resp.Body)
		if err != nil {
			fmt.Println("Error creating goquery document:", err)
			return nil
		}

		nbrItems = 0

		doc.Find(`div.wwtt_content`).Each(func(i int, item *goquery.Selection) {
			track := &nova.Track{}
			nbrItems++
			item.Find(`div.col-lg-7 > div > h2`).Each(func(i int, s *goquery.Selection) {
				track.Artist = strings.Join(strings.Split(strings.ToLower(s.Text()), "/"), " and ")
			})

			item.Find(`div.col-lg-7 div p:not([class])`).Each(func(i int, s *goquery.Selection) {
				track.Title = strings.TrimSpace(strings.ToLower(s.Text()))
			})

			item.Find(`div.col-lg-7 > div > p.time`).Each(func(i int, s *goquery.Selection) {
				track.Hour, track.Minute = splitTimeString(s.Text())
			})

			item.Find(`div.col-lg-7 > div > ul > li:nth-child(2) > a`).Each(func(i int, s *goquery.Selection) {
				track.SpotifyURL, _ = s.Attr("href")
			})

			item.Find(`div.col-lg-5 div img`).Each(func(i int, s *goquery.Selection) {
				track.ImgURL, _ = s.Attr("src")
			})

			playlist.Tracks = append(playlist.Tracks, track)
		})

		fmt.Println("Page:", page, "Number of Items:", nbrItems)
	}

	if err = playlist.SaveToDisk(); err != nil {
		log.Fatal(err)
	}

	return &playlist
}

func GetNonce() (string, error) {
	req, err := http.NewRequest("GET", "https://www.nova.fr/c-etait-quoi-ce-titre/", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authority", "www.nova.fr")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9")
	req.Header.Set("Accept-Language", "fr-FR,fr;q=0.9")
	req.Header.Set("Sec-Ch-Ua", "\"Not_A Brand\";v=\"99\", \"Google Chrome\";v=\"109\", \"Chromium\";v=\"109\"")
	req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
	req.Header.Set("Sec-Ch-Ua-Platform", "\"macOS\"")
	req.Header.Set("Sec-Fetch-Dest", "document")
	req.Header.Set("Sec-Fetch-Mode", "navigate")
	req.Header.Set("Sec-Fetch-Site", "same-origin")
	req.Header.Set("Sec-Fetch-User", "?1")
	req.Header.Set("Upgrade-Insecure-Requests", "1")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("status code error: %d %s", resp.StatusCode, resp.Status)
	}
	// load the HTML document in goquery
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", err
	}
	var nonce string
	// look for script.js-defer-js-extra
	doc.Find(`script`).Each(func(i int, s *goquery.Selection) {
		jsContent := s.Text()
		// look for nonce by finding the first index of ajax_nonce
		nonceIndex := strings.Index(jsContent, "ajax_nonce\":\"")
		if nonceIndex >= 0 {
			// look for the next index of "
			nonceEndIndex := strings.Index(jsContent[nonceIndex:], "\"")
			// return the nonce
			nonce = jsContent[nonceIndex+13 : nonceIndex+13+nonceEndIndex]
		}
	})

	return nonce, nil
}

var backoffSchedule = []time.Duration{
	30 * time.Second,
	20 * time.Second,
	30 * time.Second,
	30 * time.Second,
}

func splitTimeString(timeStr string) (int, int) {
	t := strings.Split(timeStr, ":")
	h, err := strconv.Atoi(t[0])
	if err != nil {
		panic(err)
	}
	m, err := strconv.Atoi(t[1])
	if err != nil {
		panic(err)
	}
	return h, m
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
