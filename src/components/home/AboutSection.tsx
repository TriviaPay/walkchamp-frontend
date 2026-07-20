import React, { type CSSProperties, type ReactNode } from 'react';
import { useInView } from '../../hooks/useInView';
import logoImg from '../../assets/logo.png';
import './AboutSection.css';

const aboutImage =
  'https://images.unsplash.com/photo-1624555130581-1d9cca783bc0?q=80&w=2071&auto=format&fit=crop';

type StatItem = {
  value: string;
  label: string;
  icon: ReactNode;
};

const stats: StatItem[] = [
  {
    value: '3',
    label: 'Games',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="6" y1="12" x2="10" y2="12"></line>
        <line x1="8" y1="10" x2="8" y2="14"></line>
        <line x1="15" y1="13" x2="15.01" y2="13"></line>
        <line x1="18" y1="11" x2="18.01" y2="11"></line>
        <path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"></path>
      </svg>
    ),
  },
  {
    value: '1',
    label: 'Live',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="2"></circle>
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path>
        <path d="M7.76 7.76a6 6 0 0 0 0 8.49"></path>
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        <path d="M4.93 4.93a10 10 0 0 0 0 14.14"></path>
      </svg>
    ),
  },
  {
    value: '2026',
    label: 'Founded',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
    ),
  },
];

const AboutSection: React.FC = () => {
  const { elementRef, isInView } = useInView<HTMLElement>({
    threshold: 0.2,
    rootMargin: '0px 0px -10% 0px',
  });

  return (
    <section
      className={`about-section section-shell fade-section ${isInView ? 'is-visible' : ''}`}
      id="about"
      ref={elementRef}
    >
      <div className="container about-grid">
        <div className="about-content">
          <h2 className="section-title">
            About <span className="gradient-text">Mira Gaming</span>
          </h2>
          <p className="about-text">
            <strong>Mira Gaming Private Limited</strong> is an independent game development
            company focused on accessible, high-quality mobile entertainment. Founded in 2026, we combine thoughtful
            design with reliable engineering to build games our players enjoy returning to.
          </p>

          <div className="about-highlights">
            <span>Walk Champ — available on mobile</span>
            <span>Trivia Coin & Vibe Link — in active development</span>
            <span>Mobile-first design and engineering</span>
          </div>

          <div className="stats-grid">
            {stats.map((stat, index) => (
              <div
                className="stat-item"
                key={stat.label}
                style={{ '--stat-delay': `${index * 120}ms` } as CSSProperties}
              >
                <div className="stat-icon-wrapper">{stat.icon}</div>
                <div className="stat-info">
                  <h3>{stat.value}</h3>
                  <p>{stat.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="about-image-wrapper">
          <div className="image-border"></div>
          <img
            src={aboutImage}
            alt="Gaming setup"
            className="about-img"
          />
          <div className="logo-overlay">
            <img src={logoImg} alt="Mira Gaming" className="logo-overlay-img" />
          </div>
        </div>
      </div>
    </section>
  );
};

export default AboutSection;
