import { type FC } from 'react';
import Navbar from './components/layout/Navbar';
import Hero from './components/home/Hero';
import GamesGrid from './components/home/GamesGrid';
import AboutSection from './components/home/AboutSection';
import ContactFooter from './components/layout/ContactFooter';
import './App.css';

const App: FC = () => {
  return (
    <div className="app-wrapper">
      <Navbar />
      <main>
        <Hero />
        <GamesGrid />
        <AboutSection />
      </main>
      <ContactFooter />
    </div>
  );
};

export default App;
