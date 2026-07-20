import React, { type CSSProperties, type FormEvent, useRef, useState } from 'react';
import { useInView } from '../../hooks/useInView';
import { sendContactEmail } from '../../utils/sendContactEmail';
import {
  ADMIN_EMAIL,
  careerMailto,
  partnershipMailto,
  triggerEmailAction,
  type MailtoOptions,
} from '../../utils/mailto';
import './ContactFooter.css';

const socials = [
  {
    name: 'Instagram',
    url: 'https://www.instagram.com/',
    renderIcon: (gradientId: string) => (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FEDA75" />
            <stop offset="25%" stopColor="#FA7E1E" />
            <stop offset="50%" stopColor="#D62976" />
            <stop offset="75%" stopColor="#962FBF" />
            <stop offset="100%" stopColor="#4F5BD5" />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zm0 10.162a3.999 3.999 0 1 1 0-7.998 3.999 3.999 0 0 1 0 7.998zm6.406-11.845a1.44 1.44 0 1 1-2.881 0 1.44 1.44 0 0 1 2.881 0z"
        />
      </svg>
    ),
  },
  {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/',
    renderIcon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#0A66C2"
          d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.067 2.067 0 1 1 0-4.134 2.067 2.067 0 0 1 0 4.134zM7.119 20.452H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"
        />
      </svg>
    ),
  },
  {
    name: 'YouTube',
    url: 'https://www.youtube.com/',
    renderIcon: () => (
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="#FF0000"
          d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
        />
      </svg>
    ),
  },
];

const openings = ['Game Developer', 'UI/UX Designer', '3D Artist', 'Marketing Manager'];
const MESSAGE_MAX_LENGTH = 1000;

const ContactFooter: React.FC = () => {
  const { elementRef, isInView } = useInView<HTMLElement>({
    threshold: 0.1,
    rootMargin: '0px 0px -8% 0px',
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'success' | 'error'>('idle');
  const [feedback, setFeedback] = useState('');
  const [emailToast, setEmailToast] = useState('');
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const charactersLeft = MESSAGE_MAX_LENGTH - message.length;

  const handleEmailClick = async (options: MailtoOptions) => {
    const toastMessage = await triggerEmailAction(options);
    setEmailToast(toastMessage);
    setFeedback('');
    setStatus('idle');

    if (options.body) {
      setMessage(options.body);
    }

    window.setTimeout(() => {
      document.getElementById('contact-message-form')?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
      messageRef.current?.focus();
    }, 120);

    window.setTimeout(() => setEmailToast(''), 6000);
  };

  const handleMessageChange = (value: string) => {
    setMessage(value.slice(0, MESSAGE_MAX_LENGTH));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!name.trim() || !email.trim() || !message.trim()) {
      setStatus('error');
      setFeedback('Please fill in your name, email, and message.');
      return;
    }

    setStatus('sending');
    setFeedback('');

    try {
      await sendContactEmail({ name, email, message });
      setStatus('success');
      setFeedback('Message sent. We will get back to you soon.');
      setName('');
      setEmail('');
      setMessage('');
    } catch {
      setStatus('error');
      setFeedback('Could not send your message. Please try again or email admin@miragaming.com directly.');
    }
  };

  return (
    <footer
      className={`contact-footer section-shell fade-section ${isInView ? 'is-visible' : ''}`}
      id="contact"
      ref={elementRef}
    >
      <div className="container footer-headline">
        <p>Interested in partnerships, publishing, or collaboration with Mira Gaming?</p>
        <button
          type="button"
          className="headline-btn mail-link"
          onClick={() => handleEmailClick(partnershipMailto)}
        >
          Get in touch
        </button>
      </div>

      <div className="container footer-grid">
        <div className="footer-section footer-contact">
          <h3 className="footer-title">Contact Details</h3>
          <div className="contact-info">
            <div className="contact-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="contact-icon">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              <div>
                <p className="label">Email</p>
                <p className="value">
                  <button
                    type="button"
                    className="mail-link mail-link-inline"
                    onClick={() => handleEmailClick(partnershipMailto)}
                  >
                    {ADMIN_EMAIL}
                  </button>
                </p>
              </div>
            </div>

            <div className="contact-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="contact-icon">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.81 12.81 0 0 0 .81 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.81 2 2 0 0 1 1.72 2z"></path>
              </svg>
              <div>
                <p className="label">Response Time</p>
                <p className="value">Within business hours</p>
              </div>
            </div>

            <div className="contact-item">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="contact-icon">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <div>
                <p className="label">Registered Company</p>
                <p className="value">
                  Mira Gaming Private Limited
                  <br />
                  India
                </p>
              </div>
            </div>
          </div>

          <div className="social-connect">
            <p className="label">Follow Us</p>
            <div className="social-icons">
              {socials.map((social) => (
                <a
                  href={social.url}
                  key={social.name}
                  className="social-icon"
                  aria-label={`Visit ${social.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {social.renderIcon(`ig-${social.name}`)}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="footer-section footer-message" id="contact-message-form">
          <h3 className="footer-title">Send Us a Message</h3>
          {emailToast ? (
            <p className="email-toast" role="status" aria-live="polite">
              {emailToast}
            </p>
          ) : null}
          <form className="message-form" onSubmit={handleSubmit} noValidate>
            <div className="form-row">
              <input
                type="text"
                name="name"
                placeholder="Name"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={status === 'sending'}
              />
              <input
                type="email"
                name="email"
                placeholder="Email"
                className="form-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={status === 'sending'}
              />
            </div>
            <div className="form-textarea-wrap">
              <textarea
                ref={messageRef}
                id="contact-message"
                name="message"
                placeholder="Message"
                className="form-textarea"
                rows={4}
                value={message}
                onChange={(e) => handleMessageChange(e.target.value)}
                maxLength={MESSAGE_MAX_LENGTH}
                required
                disabled={status === 'sending'}
              />
              <p
                className={`form-char-count ${charactersLeft <= 100 ? 'form-char-count-low' : ''}`}
                aria-live="polite"
              >
                {charactersLeft} characters left
              </p>
            </div>
            {feedback ? (
              <p
                className={`form-feedback ${status === 'success' ? 'form-feedback-success' : 'form-feedback-error'}`}
                role="status"
                aria-live="polite"
              >
                {feedback}
              </p>
            ) : null}
            <button type="submit" className="send-btn" disabled={status === 'sending'}>
              {status === 'sending' ? 'Sending…' : 'Send Message'}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
        </div>

        <div className="footer-section footer-opportunities">
          <div className="careers-section">
            <h3 className="footer-title">Careers / Opportunities</h3>
            <p className="careers-text">Join Our Team</p>
            <p className="careers-subtext">
              We are a growing studio and welcome enquiries from talented people who share our passion for mobile games.
            </p>
            <ul className="openings-list">
              {openings.map((opening, index) => (
                <li key={opening} style={{ '--opening-delay': `${index * 90}ms` } as CSSProperties}>
                  <span>{opening}</span>
                </li>
              ))}
            </ul>
            <p className="careers-note">
              To apply, email us at{' '}
              <button
                type="button"
                className="mail-link mail-link-inline"
                onClick={() => handleEmailClick(careerMailto)}
              >
                {ADMIN_EMAIL}
              </button>
            </p>
          </div>

          <div className="partnership-section glass-morphism">
            <h3 className="footer-title">Work With Us</h3>
            <p className="partnership-text">
              We are open to conversations with publishers, platforms, and investors aligned with our product vision.
            </p>
            <button
              type="button"
              className="partnership-btn mail-link"
              onClick={() => handleEmailClick(partnershipMailto)}
            >
              Partnership Inquiries
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="footer-bottom">
        <div className="container bottom-content">
          <div className="logo tiny-logo">
            <span className="logo-mira">Mira</span>
            <span className="logo-gaming gradient-text">Gaming</span>
          </div>
          <p className="copyright">(c) 2026 <span className="gradient-text">Mira Gaming Private Limited</span>. All rights reserved.</p>
          <div className="bottom-socials">
            <div className="icon-group">
              {socials.map((social) => (
                <a
                  href={social.url}
                  key={`bottom-${social.name}`}
                  className="icon-box-small"
                  aria-label={`Visit ${social.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {social.renderIcon(`ig-bottom-${social.name}`)}
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default ContactFooter;
