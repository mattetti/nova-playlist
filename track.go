package nova

import (
	"fmt"
	"log"

	"github.com/raitonoberu/ytmusic"
)

type Track struct {
	Artist      string
	Date        string
	Title       string
	Time        string
	Hour        int
	Minute      int
	ImgURL      string
	SpotifyURL  string
	Count       int
	YTMusicInfo *ytmusic.TrackItem
}

func (t *Track) YTPrimaryArtistURL() string {
	if t != nil && t.YTMusicInfo != nil {
		if len(t.YTMusicInfo.Artists) > 0 {
			return fmt.Sprintf("https://music.youtube.com/channel/%s", t.YTMusicInfo.Artists[0].ID)
		}
	}
	return ""
}

func (t *Track) Key() string {
	return t.Artist + "|" + t.Title
}

func (t *Track) YTMusicURL() string {
	if t.YTMusicInfo != nil {
		return "https://music.youtube.com/watch?v=" + t.YTMusicInfo.VideoID
	}
	return ""
}

func (track *Track) GetYTMusicInfo() *ytmusic.TrackItem {
	s := ytmusic.Search(fmt.Sprintf("%s by %s", track.Title, track.Artist))
	fmt.Printf(".")
	result, err := s.Next()
	if err != nil {
		log.Fatal(err)
	}
	if (len(result.Tracks)) == 0 {
		log.Println("No results for", track.Title, "by", track.Artist)
		return nil
	}
	if CleanTitle(track.Title) != CleanTitle(result.Tracks[0].Title) {
		log.Println("\tWe might have a bad match for", track.Title, "by", track.Artist)
		fmt.Println("\t", track.Title, "!=", result.Tracks[0].Title)
		a := CleanTitle(track.Title)
		b := CleanTitle(result.Tracks[0].Title)
		fmt.Println("\t", a, "!=", b)
		// fmt.Printf("%v\n", []byte(a))
		// fmt.Printf("%v\n", []byte(b))
		// return nil
	}

	// fmt.Printf("Got YTMusicID for %s by %s : %+v/n", track.Title, track.Artist, result.Tracks[0])
	return result.Tracks[0]
}

func (t *Track) ThumbURL() string {
	if t == nil {
		return ""
	}

	if t.YTMusicInfo != nil && len(t.YTMusicInfo.Thumbnails) > 0 {
		return t.YTMusicInfo.Thumbnails[len(t.YTMusicInfo.Thumbnails)-1].URL
	}

	return t.ImgURL
}
