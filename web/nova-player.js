// Wait for required libraries to load
function waitForLibraries() {
  return new Promise((resolve) => {
    function checkLibraries() {
      if (window.React && window.ReactDOM && window.lucide) {
        resolve();
      } else {
        setTimeout(checkLibraries, 100);
      }
    }
    checkLibraries();
  });
}

async function initializePlayer() {
  console.log('Starting player initialization...');
  await waitForLibraries();
  console.log('Libraries loaded:', {
    react: !!window.React,
    reactDOM: !!window.ReactDOM,
    lucide: !!window.lucide,
    yt: !!window.YT
  });

  const { useState, useEffect, useRef } = React;

  // Create Lucide icon components
  const createIcon = (iconName, props = {}) => {
    // Convert iconName to kebab case as required by Lucide
    const kebabName = iconName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

    // Create the icon element using Lucide's global function
    const element = window.lucide.createIcons({
      icons: {
        [kebabName]: {
          width: props.size || 24,
          height: props.size || 24,
        }
      }
    });

    // Return a React element that wraps the icon
    return React.createElement('i', {
      className: `lucide lucide-${kebabName}`,
      style: { display: 'inline-block', width: props.size || 24, height: props.size || 24 }
    });
  };

  const NovaPlayer = () => {
    const [currentTrack, setCurrentTrack] = useState(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [playMode, setPlayMode] = useState('sequential');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [tracks, setTracks] = useState([]);

    const playerRef = useRef(null);
    const youtubePlayerRef = useRef(null);
    const tracksRef = useRef([]); // Keep a ref to tracks for event handlers
    const currentIndexRef = useRef(0); // Add ref for current index

    useEffect(() => {
      // Load tracks from playlist table
      const trackElements = document.querySelectorAll('.playlist-entry');
      const loadedTracks = Array.from(trackElements).map(track => ({
        title: track.querySelector('.title').textContent,
        artist: track.querySelector('.artist-name').textContent,
        ytMusicUrl: track.querySelector('a[href*="music.youtube.com"]').href,
        videoId: extractVideoId(track.querySelector('a[href*="music.youtube.com"]').href)
      }));

      console.log('Loaded tracks:', loadedTracks.length);
      setTracks(loadedTracks);
      tracksRef.current = loadedTracks; // Store in ref for event handlers

      // Preload first track in state (but don't play it)
      if (loadedTracks.length > 0) {
        setCurrentTrack(loadedTracks[0]);
        setCurrentIndex(0);
      }

      // Initialize YouTube IFrame API
      if (window.YT) {
        initializeYouTubePlayer();
      } else {
        window.onYouTubeIframeAPIReady = initializeYouTubePlayer;
      }

      // Add click handlers to playlist entries
      const handleTrackClick = (index, e) => {
        if (e.target.tagName === 'A') return;
        e.preventDefault();
        console.log('Manual track selection at index:', index);
        setCurrentIndex(index);
        currentIndexRef.current = index; // Update ref
        playTrack(loadedTracks[index], index);
      };

      trackElements.forEach((el, index) => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', (e) => handleTrackClick(index, e));
      });

      // Add styles for active track
      const style = document.createElement('style');
      style.textContent = `
        .playlist-entry.playing {
          background-color: rgba(139, 92, 246, 0.1);
        }
        .playlist-entry:hover {
          background-color: rgba(139, 92, 246, 0.05);
        }
      `;
      document.head.appendChild(style);

      // Cleanup
      return () => {
        trackElements.forEach((el, index) => {
          el.style.cursor = '';
          el.removeEventListener('click', (e) => handleTrackClick(index, e));
        });
        document.head.removeChild(style);
        if (youtubePlayerRef.current) {
          youtubePlayerRef.current.destroy();
        }
      };
    }, []);

    const initializeYouTubePlayer = () => {
      youtubePlayerRef.current = new window.YT.Player('youtube-player', {
        height: '120',
        width: '200',
        videoId: '',
        playerVars: {
          playsinline: 1,
          controls: 1,
          origin: window.location.origin,
          enablejsapi: 1,
          autoplay: 1
        },
        events: {
          onReady: (event) => {
            console.log('YouTube player ready');
            youtubePlayerRef.current = event.target;
          },
          onStateChange: onPlayerStateChange,
          onError: (e) => console.error('YouTube player error:', e.data)
        }
      });
    };

    const extractVideoId = (url) => {
      const match = url.match(/[?&]v=([^&]+)/);
      return match ? match[1] : '';
    };

    const playTrack = (track, index) => {
      if (!youtubePlayerRef.current || !track?.videoId) {
        console.log('Player or video ID not ready:', {
          player: !!youtubePlayerRef.current,
          videoId: track?.videoId
        });
        return;
      }

      // Verify that the player is ready and has the required methods
      if (typeof youtubePlayerRef.current.loadVideoById !== 'function') {
        console.log('Player methods not ready yet');
        return;
      }

      console.log('Playing track at index:', index);
      setCurrentTrack(track);
      setCurrentIndex(index);
      currentIndexRef.current = index; // Update ref
      setIsPlaying(true);

      try {
        youtubePlayerRef.current.loadVideoById({
          videoId: track.videoId,
          startSeconds: 0
        });
        updatePlaylistHighlight(index);
      } catch (error) {
        console.error('Error playing track:', error);
      }
    };

    const updatePlaylistHighlight = (index) => {
      document.querySelectorAll('.playlist-entry').forEach((el, i) => {
        if (i === index) {
          el.classList.add('playing');
        } else {
          el.classList.remove('playing');
        }
      });
    };

    const togglePlayMode = () => {
      setPlayMode(prev => prev === 'sequential' ? 'random' : 'sequential');
    };

    const togglePlayPause = () => {
      if (!youtubePlayerRef.current) return;

      if (isPlaying) {
        youtubePlayerRef.current.pauseVideo();
        setIsPlaying(false);
      } else {
        if (!currentTrack) {
          if (tracksRef.current.length > 0) {
            playTrack(tracksRef.current[0], 0);
          }
        } else {
          if (youtubePlayerRef.current.getPlayerState() === window.YT.PlayerState.ENDED) {
            // If current track ended, play next instead of replaying current
            playNextTrack();
          } else {
            youtubePlayerRef.current.playVideo();
            setIsPlaying(true);
          }
        }
      }
    };

    const playNextTrack = () => {
      console.log('playNextTrack called, current index:', currentIndexRef.current);
      const availableTracks = tracksRef.current;

      if (!availableTracks.length) {
        console.log('No tracks available');
        return;
      }

      let nextIndex;
      if (playMode === 'random') {
        do {
          nextIndex = Math.floor(Math.random() * availableTracks.length);
        } while (nextIndex === currentIndexRef.current && availableTracks.length > 1);
      } else {
        // Use the current index from ref as the base for finding the next track
        nextIndex = (currentIndexRef.current + 1) % availableTracks.length;
        console.log('Sequential mode - current:', currentIndexRef.current, 'next:', nextIndex);
      }

      console.log('Playing next track at index:', nextIndex, 'out of', availableTracks.length, 'tracks');
      playTrack(availableTracks[nextIndex], nextIndex);
    };

    const onPlayerStateChange = (event) => {
      console.log('Player state changed:', event.data);

      if (event.data === window.YT.PlayerState.ENDED) {
        console.log('Track ended, playing next...');
        playNextTrack();
      } else if (event.data === window.YT.PlayerState.PAUSED) {
        console.log('Track paused');
        setIsPlaying(false);
      } else if (event.data === window.YT.PlayerState.PLAYING) {
        console.log('Track playing');
        setIsPlaying(true);
      }
    };

    // Create the component's elements using React.createElement
    return       React.createElement(
      'div',
      {
        className: 'fixed bottom-4 right-4 w-80 bg-gray-900 text-white shadow-lg rounded-lg border border-gray-800',
        ref: playerRef,
        style: {
          zIndex: 50,
          backdropFilter: 'blur(10px)',
          backgroundColor: 'rgba(17, 24, 39, 0.95)'
        }
      },
      React.createElement(
        'div',
        { className: 'p-3' },
        React.createElement(
          'div',
          { className: 'flex items-center justify-between mb-2' },
        React.createElement(
          'div',
          { className: 'flex items-center gap-2' },
          createIcon('volume-2', { size: 18 }),
          React.createElement('span', { className: 'font-medium text-sm bg-gradient-to-r from-purple-400 to-pink-600 bg-clip-text text-transparent' }, 'Nova Radio')
        ),
        React.createElement(
          'button',
          {
            onClick: togglePlayMode,
            className: 'p-2 rounded-full hover:bg-gray-700 flex items-center gap-2 text-gray-300 hover:text-white transition-colors',
            title: playMode === 'sequential' ? 'Switch to random' : 'Switch to sequential'
          },
          [
            createIcon(playMode === 'sequential' ? 'list-ordered' : 'shuffle', { size: 20 }),
            React.createElement(
              'span',
              { className: 'text-sm' },
              playMode === 'sequential' ? 'Sequential' : 'Random'
            )
          ]
        )
      ),
      React.createElement(
        'div',
        { className: 'flex items-center justify-between' },
        React.createElement(
          'div',
          { className: 'space-y-1 flex-1 min-w-0' },
          React.createElement(
            'p',
            { className: 'text-sm font-medium leading-none truncate text-gray-100' },
            currentTrack ? currentTrack.title : 'Click any track to play'
          ),
          React.createElement(
            'p',
            { className: 'text-sm text-gray-400 truncate' },
            currentTrack ? currentTrack.artist : 'Or use the play button for sequential playback'
          )
        ),
        React.createElement(
          'div',
          { className: 'flex items-center gap-4 ml-4' },
          React.createElement(
            'button',
            {
              onClick: togglePlayPause,
              className: 'p-2 rounded-full hover:bg-gray-700 text-gray-300 hover:text-white transition-colors',
              title: isPlaying ? 'Pause' : 'Play'
            },
            createIcon(isPlaying ? 'pause' : 'play', { size: 24 })
          ),
          React.createElement(
            'button',
            {
              onClick: playNextTrack,
              className: 'p-2 rounded-full hover:bg-gray-100',
              title: playMode === 'sequential' ? 'Next Track' : 'Random Track'
            },
            createIcon('skip-forward', { size: 18 })
          )
        )
      ),
      React.createElement('div', {
        id: 'youtube-player',
        className: 'w-full h-[120px] mt-2 bg-gray-800 rounded-lg overflow-hidden'
      })
    ));
  };

  // Initialize the player
  const root = ReactDOM.createRoot(document.getElementById('nova-player-root'));
  root.render(React.createElement(NovaPlayer));
}

// Start initialization when the page loads
window.addEventListener('load', initializePlayer);