package nova

import (
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/mattetti/goRailsYourself/inflector"
)

var client http.Client

func init() {
	jar, err := cookiejar.New(nil)
	if err != nil {
		log.Fatalf("Got error while creating cookie jar %s", err.Error())
	}

	client = http.Client{
		Jar: jar,
	}
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

	page := 0
	nbrItems := 99
	dDate := fmt.Sprintf("%d-%d-%d", t.Year(), t.Month(), t.Day())

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
		req.Header.Set("Cache-Control", "no-cache")
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

		// wait 2 second between requests (throttling to not overwhelm the server)
		if time.Since(lastRequest) < 2*time.Second {
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
			log.Printf("failed to retrieve playlist for %s, page %d\n", dDate, page)
			return nil
		}

		doc, err := goquery.NewDocumentFromReader(resp.Body)
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

		fmt.Println("Page:", page, "Number of Items:", nbrItems)
	}

	if err = playlist.SaveToDisk(); err != nil {
		log.Fatal(err)
	}

	return playlist
}

func GetPlaylists(startDate, endDate time.Time) []*Playlist {
	nonce, err := GetNonce()
	if err != nil {
		fmt.Println("Error getting the nonce:", err)
		log.Fatal(err)
	}
	var playlists []*Playlist
	fmt.Println("Getting the playlists for", startDate.String(), "to", endDate.String())

	for date := startDate; date.Before(endDate); date = date.AddDate(0, 0, 1) {
		playlist := GetPlaylist(date, nonce)
		if playlist != nil {
			playlists = append(playlists, playlist)
		}
	}

	return playlists
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
