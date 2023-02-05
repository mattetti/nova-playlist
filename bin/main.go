package main

import (
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/mattetti/nova-playlist"
)

func main() {
	globalPlaylist := nova.Playlist{Date: "global"}

	// if the user passed a -fetch flag, run the code, otherwise exit
	if len(os.Args) > 1 && os.Args[1] == "-fetch" {

		date := time.Now().UTC()

		// start 2 weeks from now and get the playlist for each day
		for i := 0; i < 30; i++ {
			date = date.Add(-time.Hour * 24)

			playlist := getPlaylist(date)
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

}

func getPlaylist(date time.Time) *nova.Playlist {
	// yesterday
	date = date.Add(-time.Hour * 24)
	date = time.Date(date.Year(), date.Month(), date.Day(), 23, 59, 0, 0, time.UTC)

	// yesterday
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

	for page < 100 && nbrItems > 0 {
		page++

		dDate = fmt.Sprintf("%d-%d-%d", t.Year(), t.Month(), t.Day())
		payload := "action=loadmore_programs&afp_nonce=f03afb6fe9"
		payload += "&date=" + dDate
		payload += "&time=" + url.QueryEscape("23:59")
		payload += "&page=" + fmt.Sprintf("%d", page)
		payload += "&radio=910"

		client := &http.Client{}

		body := strings.NewReader(payload)
		req, err := http.NewRequest("POST", "https://www.nova.fr/wp-admin/admin-ajax.php", body)
		if err != nil {
			log.Fatal(err)
		}
		req.Header.Set("Authority", "www.nova.fr")
		req.Header.Set("Accept", "*/*")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9,fr-FR;q=0.8,fr;q=0.7,es-US;q=0.6,es;q=0.5")
		req.Header.Set("Cache-Control", "no-cache")
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
		req.Header.Set("Dnt", "1")
		req.Header.Set("Origin", "https://www.nova.fr")
		req.Header.Set("Pragma", "no-cache")
		req.Header.Set("Referer", "https://www.nova.fr/c-etait-quoi-ce-titre/")
		req.Header.Set("Sec-Ch-Ua", "\"Not_A Brand\";v=\"99\", \"Google Chrome\";v=\"109\", \"Chromium\";v=\"109\"")
		req.Header.Set("Sec-Ch-Ua-Mobile", "?0")
		req.Header.Set("Sec-Ch-Ua-Platform", "\"macOS\"")
		req.Header.Set("Sec-Fetch-Dest", "empty")
		req.Header.Set("Sec-Fetch-Mode", "cors")
		req.Header.Set("Sec-Fetch-Site", "same-origin")
		req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36")
		req.Header.Set("X-Requested-With", "XMLHttpRequest")

		resp, err := client.Do(req)
		if err != nil {
			log.Fatal(err)
		}

		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			log.Fatalf("status code error: %d %s", resp.StatusCode, resp.Status)
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
