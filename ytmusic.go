package nova

import (
	"compress/gzip"
	"encoding/gob"
	"fmt"
	"os"

	"github.com/raitonoberu/ytmusic"
)

var (
	YTMusicCachePath = "data/ytmusic.gob.gz"
	YTMusic          *YTMusicCache
)

type YTMusicCache struct {
	Matches map[string]*ytmusic.SearchResult
}

func (yt *YTMusicCache) TrackInfo(query string) (*ytmusic.TrackItem, error) {
	if yt == nil {
		return nil, fmt.Errorf("YT Music cache is not loaded, load it first using nova.LoadYTMusicCache()")
	}
	if yt.Matches[query] != nil {
		return yt.Matches[query].Tracks[0], nil
	}

	s := ytmusic.Search(query)
	fmt.Printf(".")
	result, err := s.Next()
	if err != nil {
		return nil, fmt.Errorf("failed to get the next yt music result for %s: %w", query, err)
	}
	if (len(result.Tracks)) == 0 {
		return nil, fmt.Errorf("no results for %s", query)
	}
	yt.Matches[query] = result

	// TODO: double check that the top result is a match

	// fmt.Printf("Got YTMusicID for %s by %s : %+v/n", track.Title, track.Artist, result.Tracks[0])
	return result.Tracks[0], nil
}

func (yt *YTMusicCache) Save() error {
	if yt == nil {
		return fmt.Errorf("yt music cache is not loaded")
	}
	file, err := os.Create(YTMusicCachePath)
	if err != nil {
		return fmt.Errorf("failed to create the yt cache file %w", err)
	}
	defer file.Close()

	gzipWriter := gzip.NewWriter(file)
	defer gzipWriter.Close()

	encoder := gob.NewEncoder(gzipWriter)
	if err := encoder.Encode(yt); err != nil {
		return fmt.Errorf("failed to encode the ytmusic cache %w", err)
	}
	return nil
}

func LoadYTMusicCache() (*YTMusicCache, error) {
	// check if the YTMusicCachePath exists
	// if it does, it opens the file
	_, err := os.Stat(YTMusicCachePath)
	if err != nil {
		if os.IsNotExist(err) {
			fmt.Println("Creating a new cache")
			file, err := os.Create(YTMusicCachePath)
			if err != nil {
				return nil, fmt.Errorf("failed to create the cache file %w", err)
			}
			defer file.Close()
			YTMusic = &YTMusicCache{Matches: make(map[string]*ytmusic.SearchResult)}
			return YTMusic, nil
		}
	}

	file, err := os.Open(YTMusicCachePath)
	if err != nil {
		fmt.Printf("failed to open the file from disk %v\n", err)
		fmt.Println("Creating a new cache")
		file, err = os.Create(YTMusicCachePath)
		if err != nil {
			return nil, fmt.Errorf("failed to create the cache file %w", err)
		}
		YTMusic = &YTMusicCache{Matches: make(map[string]*ytmusic.SearchResult)}
		return YTMusic, nil
	}
	defer file.Close()

	YTMusic = &YTMusicCache{Matches: make(map[string]*ytmusic.SearchResult)}

	// decode the file into playlist
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		return nil, fmt.Errorf("failed to create gzip reader: %w", err)
	}
	defer gzipReader.Close()

	// decode the file into playlist
	decoder := gob.NewDecoder(gzipReader)
	if err := decoder.Decode(YTMusic); err != nil {
		return nil, fmt.Errorf("failed to decode the yt music cache %w", err)
	}
	return YTMusic, nil
}
