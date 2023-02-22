package nova

import (
	"bytes"
	"fmt"
	"log"
	"net/http"
	"net/http/cookiejar"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/mattetti/goRailsYourself/inflector"
)

var client http.Client
var httpCache *HTTPCache

func init() {
	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatalf("Got error while creating cookie jar %s", err.Error())
	}

	client = http.Client{
		Jar: jar,
	}

	httpCache = &HTTPCache{dir: "data/http-cache"}
	os.MkdirAll(httpCache.dir, 0755)
}

var backoffSchedule = []time.Duration{
	30 * time.Second,
	20 * time.Second,
	30 * time.Second,
	30 * time.Second,
}

func GetPlaylist(date time.Time, nonce string) *Playlist {
	t := date
	fmt.Println("Getting the playlist for", t.String())

	totalNbrItems := 0
	page := 0
	nbrItems := 99
	// dDate := fmt.Sprintf("%d-%d-%d", t.Year(), t.Month(), t.Day())

	playlist := &Playlist{Year: t.Year(), Month: int(t.Month()), Day: t.Day()}
	err := playlist.LoadFromDisk()

	if err == nil {
		return playlist
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

		// wait a bit in between requests (throttling to not overwhelm the server)
		if time.Since(lastRequest) < (time.Second) {
			time.Sleep(time.Second - time.Since(lastRequest))
		}
		body, fromCache, err := httpCache.GetPlaylistPage(t, page, nonce)
		if err != nil {
			fmt.Println("Error getting the playlist page:", err)
			return nil
		}
		if !fromCache {
			lastRequest = time.Now()
		}

		// create a bytes reader from the body
		r := bytes.NewReader(body)

		doc, err := goquery.NewDocumentFromReader(r)
		if err != nil {
			fmt.Println("Error creating goquery document:", err)
			return nil
		}

		nbrItems = 0

		doc.Find(`div.wwtt_content`).Each(func(i int, item *goquery.Selection) {
			track := &Track{}
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

		totalNbrItems += nbrItems
		fmt.Println("Page:", page, "Number of Items:", nbrItems)
	}

	if totalNbrItems == 0 {
		fmt.Println("No items found for", t.String())
		return nil
	} else {
		if err = playlist.SaveToDisk(); err != nil {
			log.Fatal(err)
		}
	}

	return playlist
}

func GetPlaylists(startDate, endDate time.Time) ([]*Playlist, error) {
	nonce, err := GetNonce()
	if err != nil {
		fmt.Println("Error getting the nonce:", err)
		log.Fatal(err)
	}
	var playlists []*Playlist
	fmt.Println("Getting the playlists for", startDate.String(), "to", endDate.String())

	for date := startDate; date.Before(endDate); date = date.AddDate(0, 0, 1) {
		playlist := GetPlaylist(date, nonce)
		if playlist == nil {
			fmt.Println("Error getting the playlist for", date.String())
			// err = fmt.Errorf("Error getting the playlist for %s", date.String())
		} else {
			playlists = append(playlists, playlist)
		}
	}

	return playlists, err
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

	resp, err := client.Do(req)
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

func CleanTitle(title string) string {
	t := strings.ToLower(inflector.Transliterate(title))
	t = strings.ReplaceAll(t, ",", "")
	startIndex := strings.Index(t, "(")
	endIndex := strings.Index(t, ")")
	if startIndex != -1 && endIndex != -1 && endIndex > startIndex {
		t = t[:startIndex] + t[endIndex+1:]
	}
	t = strings.TrimSpace(t)

	return t
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

func FileExists(filename string) bool {
	info, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return !info.IsDir()
}

func MonthEnglishName(month time.Month) string {

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
