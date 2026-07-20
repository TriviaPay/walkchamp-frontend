export const ADMIN_EMAIL = 'admin@miragaming.com';

export type MailtoOptions = {
  to: string;
  subject: string;
  body?: string;
};

export function buildMailtoHref({ to, subject, body }: MailtoOptions): string {
  const params = new URLSearchParams();
  params.set('subject', subject);
  if (body) {
    params.set('body', body);
  }
  return `mailto:${to}?${params.toString()}`;
}

export const partnershipMailto: MailtoOptions = {
  to: ADMIN_EMAIL,
  subject: 'Partnership Inquiry - Mira Gaming',
  body:
    'Hello Mira Gaming team,\n\n' +
    'I am interested in discussing a partnership, publishing, or collaboration opportunity.\n\n' +
    'Best regards,\n',
};

export const careerMailto: MailtoOptions = {
  to: ADMIN_EMAIL,
  subject: 'Career Enquiry - Mira Gaming',
  body:
    'Hello Mira Gaming team,\n\n' +
    'I would like to apply for a position at your studio.\n\n' +
    'Best regards,\n',
};

export async function triggerEmailAction(options: MailtoOptions): Promise<string> {
  const href = buildMailtoHref(options);

  try {
    window.location.href = href;
  } catch {
    // Fall through to clipboard + form flow.
  }

  try {
    await navigator.clipboard.writeText(options.to);
  } catch {
    // Clipboard may be blocked; toast still guides the user.
  }

  return `Opening email to ${options.to}. If nothing opens, use the message form below or email us directly.`;
}
