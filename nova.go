package nova

import (
	"strings"

	"github.com/mattetti/goRailsYourself/inflector"
)

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
