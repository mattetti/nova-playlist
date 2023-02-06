package nova

import (
	"fmt"
	"log"
	"time"

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
		for _, artist := range t.YTMusicInfo.Artists {
			if artist.ID != "" {
				return fmt.Sprintf("https://music.youtube.com/channel/%s", artist.ID)
			}
		}
		// fmt.Println("YT artist ID missing in the track data for", t.Title, "by", t.Artist, "trying to get it from the search results...")
		info, err := YTMusic.ArtistInfo(t.Artist)
		if err == nil && info != nil && info.BrowseID != "" {
			fmt.Println("Found info from the search results for", t.Artist, ":", info.Artist)
			return fmt.Sprintf("https://music.youtube.com/channel/%s", info.BrowseID)
		}
	}
	return "#"
}

func (t *Track) YTDuration() string {
	if t != nil && t.YTMusicInfo != nil {
		return time.Duration(t.YTMusicInfo.Duration * int(time.Second)).String()
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
	query := fmt.Sprintf("%s by %s", track.Title, track.Artist)
	info, err := YTMusic.TrackInfo(query)
	if err != nil {
		log.Println(err)
		return nil
	}
	return info
	/*
		s := ytmusic.Search(query)
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
	*/
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
