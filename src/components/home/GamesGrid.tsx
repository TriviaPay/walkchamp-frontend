import React, { type CSSProperties } from 'react';
import { useInView } from '../../hooks/useInView';
import walkChampImg from '../../assets/walkchamp.png';
import triviCoinImg from '../../assets/triviacoin.png';
import vibeLinkImg from '../../assets/vibelink.png';
import './GamesGrid.css';

type Game = {
  title: string;
  description: string;
  image: string;
  color: string;
  genre: string;
  platform: string;
  status: 'Live' | 'Under Development';
  playStoreUrl?: string;
  appStoreUrl?: string;
};

/*
const legacyGames: Game[] = [
  {
    title: 'COIN DROP DASH',
    description: 'Master the gravity-defying challenge, collect coins, and outpace the clock in this hyper-casual thrill.',
    image: 'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?q=80&w=2070&auto=format&fit=crop',
    color: '#fbbf24',
    genre: 'Hyper Casual',
    platform: 'Web + App',
    status: 'Under Development',
  },
  {
    title: 'LUDO LEAGUE',
    description: 'Fast multiplayer ludo with private rooms, tournaments, and emoji-powered play.',
    image: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=2071&auto=format&fit=crop',
    color: '#a78bfa',
    genre: 'Family PvP',
    platform: 'Mobile + PC',
    status: 'Under Development',
  },
  {
    title: 'SNAKE & LADDER',
    description: 'Climb fast, dodge snakes, and race to the finish in ranked and casual rooms.',
    image: 'https://images.unsplash.com/photo-1611996575749-79a3a250f948?q=80&w=2070&auto=format&fit=crop',
    color: '#2563eb',
    genre: 'Board Classic',
    platform: 'Mobile + Web',
    status: 'Under Development',
  },
  {
    title: 'TRIVIA COIN',
    description: 'Answer timed trivia rounds, streak wins, and earn coins on the leaderboard.',
    image: 'https://images.unsplash.com/photo-1550745165-9bc0b252726f?q=80&w=2070&auto=format&fit=crop',
    color: '#f97316',
    genre: 'Quiz Battle',
    platform: 'Web + App',
    status: 'Under Development',
  },
];
*/

const games: Game[] = [
  {
    title: 'WALK CHAMP',
    description: 'Turn every step into a win. Compete in walking challenges, climb leaderboards, and stay active with friends.',
    image: walkChampImg,
    color: '#22c55e',
    genre: 'Fitness PvP',
    platform: 'Mobile',
    status: 'Live',
    playStoreUrl: 'https://play.google.com/store/apps/details?id=com.miragaming.walkchamp',
    appStoreUrl: 'https://apps.apple.com/app/walk-champ/id1234567890',
  },
  {
    title: 'TRIVIA COIN',
    description: 'Answer timed trivia rounds, build streaks, and earn coins on the leaderboard. Currently in active development.',
    image: triviCoinImg,
    color: '#f97316',
    genre: 'Quiz Battle',
    platform: 'Web + App',
    status: 'Under Development',
  },
  {
    title: 'VIBE LINK',
    description: 'Connect, share vibes, and play together in a social gaming experience. Coming soon from Mira Gaming.',
    image: vibeLinkImg,
    color: '#a78bfa',
    genre: 'Social Play',
    platform: 'Mobile + Web',
    status: 'Under Development',
  },
];

const GamesGrid: React.FC = () => {
  const { elementRef, isInView } = useInView<HTMLElement>({
    threshold: 0.14,
    rootMargin: '0px 0px -10% 0px',
  });

  return (
    <section
      className={`games-section section-shell fade-section ${isInView ? 'is-visible' : ''}`}
      id="games"
      ref={elementRef}
    >
      <div className="container">
        <div className="section-header">
          <p className="section-tag">OUR GAMES</p>
          <h2 className="section-title">Games Developed</h2>
          <p className="section-subtitle">
            Explore our lineup from <span className="gradient-text">Mira Gaming</span> — one title live today and two more in active development.
          </p>
          <div className="title-glow"></div>
        </div>

        <div className="games-grid">
          {games.map((game, index) => (
            <article
              className="game-card glass-morphism"
              key={game.title}
              style={{
                '--accent-color': game.color,
                '--stagger-delay': `${index * 120}ms`,
              } as CSSProperties}
            >
              <div className="game-img-wrapper">
                <img src={game.image} alt={game.title} className="game-img" />
                <div className="card-gradient"></div>
                <div className="game-badge">{game.genre}</div>
              </div>
              <div className="game-info">
                <h3 className="game-title">{game.title}</h3>
                <p className="game-desc">{game.description}</p>
                <div className="game-meta">
                  <span>{game.platform}</span>
                  <span className={game.status === 'Live' ? 'status-live' : 'status-dev'}>
                    {game.status}
                  </span>
                </div>
                {game.status === 'Live' && (game.playStoreUrl || game.appStoreUrl) ? (
                  <div className="store-links-wrap">
                    <p className="store-links-label">Available on</p>
                    <div className="store-links">
                      {game.playStoreUrl ? (
                        <a
                          href={game.playStoreUrl}
                          className="store-link"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Get on Google Play
                        </a>
                      ) : null}
                      {game.appStoreUrl ? (
                        <a
                          href={game.appStoreUrl}
                          className="store-link store-link-apple"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Get on App Store
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : game.status === 'Live' ? (
                  <span className="learn-more coming-soon">Coming Soon</span>
                ) : (
                  <span className="learn-more coming-soon">Coming Soon</span>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default GamesGrid;
