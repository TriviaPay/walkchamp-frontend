import React from 'react';
import Lottie from 'lottie-react';
import heroBg from '../../assets/bg.png';
import hiThereAnimation from '../../assets/Hi there!.json';
import './Hero.css';

const Hero: React.FC = () => {
  return (
    <section className="hero-section section-shell" id="home">
      <div className="hero-background">
        <img
          src={heroBg}
          alt="Mira Gaming studio background"
          className="hero-bg-img"
        />
        <div className="hero-animated-layers" aria-hidden="true">
          <div className="hero-scanline" />
          <div className="hero-hud-ring hero-hud-ring-a" />
          <div className="hero-hud-ring hero-hud-ring-b" />
          <div className="hero-energy-orb" />
          <div className="hero-particle-field">
            <span className="particle p1" />
            <span className="particle p2" />
            <span className="particle p3" />
            <span className="particle p4" />
            <span className="particle p5" />
            <span className="particle p6" />
            <span className="particle p7" />
          </div>
          <div className="hero-laser-trails">
            <span className="laser laser-a" />
            <span className="laser laser-b" />
            <span className="laser laser-c" />
          </div>
          <div className="hero-target-nodes">
            <span className="target-node node-a" />
            <span className="target-node node-b" />
            <span className="target-node node-c" />
          </div>
        </div>
      </div>

      <div className="container hero-content">
        <h1 className="hero-visually-hidden">Mira Gaming</h1>

        <div className="hero-text-wrapper">
          <p className="hero-kicker">Independent Game Studio</p>
          <p className="hero-subtitle">
            <strong>Mira Gaming Private Limited</strong> is a passionate game development studio
            focused on crafting innovative, high-quality mobile games for players worldwide. We blend
            creativity, cutting-edge technology, and intuitive design to create immersive gaming
            experiences that are engaging, visually stunning, and enjoyable for players of all ages.
            Whether it&apos;s casual entertainment, competitive gameplay, or social experiences, our
            mission is to develop games that inspire, connect, and leave a lasting impression.
          </p>

          <div className="hero-details">
            <div className="hero-actions">
              <a href="#games" className="primary-btn">
                View Our Games
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </a>
              <a href="#contact" className="secondary-btn">
                Contact Us
              </a>
            </div>

            <div className="hero-status-ticker" aria-label="Studio updates">
              <div className="ticker-track">
                <span>WalkChamp — Now Available</span>
                <span>Trivia Coin — In Development</span>
                <span>Vibe Link — In Development</span>
                <span>Mira Gaming Private Limited</span>
              </div>
              <div className="ticker-track" aria-hidden="true">
                <span>WalkChamp — Now Available</span>
                <span>Trivia Coin — In Development</span>
                <span>Vibe Link — In Development</span>
                <span>Mira Gaming Private Limited</span>
              </div>
            </div>

            <div className="hero-metrics">
              <div className="metric-pill">
                <span className="metric-value">3</span>
                <span className="metric-label">Mobile Games</span>
              </div>
              <div className="metric-pill">
                <span className="metric-value">1</span>
                <span className="metric-label">Available Now</span>
              </div>
              <div className="metric-pill">
                <span className="metric-value">2</span>
                <span className="metric-label">Coming Soon</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hero-mascot" aria-hidden="true">
          <div className="hero-mascot-scene">
            <div className="hero-mascot-ring hero-mascot-ring-a" />
            <div className="hero-mascot-ring hero-mascot-ring-b" />
            <Lottie
              animationData={hiThereAnimation}
              loop
              className="hero-mascot-lottie"
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default Hero;
