import React, { useEffect, useState } from 'react';
import logoImg from '../../assets/logo.png';
import './Navbar.css';

const navItems = [
  { label: 'Home', href: '#home' },
  { label: 'Games', href: '#games' },
  { label: 'About', href: '#about' },
];

const Navbar: React.FC = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);

      const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = documentHeight > 0 ? (window.scrollY / documentHeight) * 100 : 0;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 1024) {
        setMenuOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className={`fixed-navbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-progress-track">
        <div className="nav-progress-line" style={{ width: `${scrollProgress}%` }} />
      </div>

      <div className="container nav-content">
        <a className="logo" href="#home" onClick={closeMenu}>
          <img src={logoImg} alt="" className="logo-img" aria-hidden="true" />
          <span className="logo-mira">Mira</span>
          <span className="logo-gaming">Gaming</span>
        </a>

        <ul className={`nav-links ${menuOpen ? 'open' : ''}`}>
          {navItems.map((item) => (
            <li key={item.href}>
              <a href={item.href} onClick={closeMenu}>
                {item.label}
              </a>
            </li>
          ))}
          <li className="mobile-contact-link">
            <a href="#contact" onClick={closeMenu}>
              Get in Touch
            </a>
          </li>
        </ul>

        <a href="#contact" className="get-in-touch-btn">
          Get in Touch
        </a>

        <button
          type="button"
          className={`mobile-menu-icon ${menuOpen ? 'open' : ''}`}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span />
          <span />
          <span />
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
