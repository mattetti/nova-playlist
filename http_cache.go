package nova

import (
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type HTTPCache struct {
	dir   string
	mutex sync.Mutex
}

func (c *HTTPCache) GetPlaylistPage(date time.Time, page int, nonce string) ([]byte, bool, error) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	dDate := fmt.Sprintf("%04d-%02d-%02d", date.Year(), date.Month(), date.Day())

	cacheFilePath := fmt.Sprintf("%s/%d/%02d/%02d/playlist-page-%s-%d.html", c.dir, date.Year(), date.Month(), date.Day(), dDate, page)

	if FileExists(cacheFilePath) {
		body, err := ioutil.ReadFile(cacheFilePath)
		if err == nil {
			fmt.Println("x")
			return body, true, nil
		}
	}

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
		break
	}

	if (resp == nil) || (resp.StatusCode != 200) {
		log.Printf("failed to retrieve playlist for %s, page %d\n", dDate, page)
		return nil, false, fmt.Errorf("failed to retrieve playlist for %s, page %d - status code: %d", dDate, page, resp.StatusCode)
	}
	ioBody, err := ioutil.ReadAll(resp.Body)
	if err == nil {
		dir := filepath.Dir(cacheFilePath)
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			_ = os.MkdirAll(dir, 0700)
		}
		err = ioutil.WriteFile(cacheFilePath, ioBody, 0644)
		if err != nil {
			fmt.Println("Error writing the playlist to cache:", err)
		}
	}
	return ioBody, false, err

}
