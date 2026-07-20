const ADMIN_EMAIL = 'admin@miragaming.com';

export type ContactFormData = {
  name: string;
  email: string;
  message: string;
};

export async function sendContactEmail(data: ContactFormData): Promise<void> {
  const response = await fetch(`https://formsubmit.co/ajax/${ADMIN_EMAIL}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      name: data.name.trim(),
      email: data.email.trim(),
      message: data.message.trim(),
      _subject: `Mira Gaming — message from ${data.name.trim()}`,
      _template: 'table',
      _captcha: 'false',
    }),
  });

  if (!response.ok) {
    throw new Error('Email request failed');
  }

  const result = (await response.json()) as { success?: string | boolean };
  if (result.success !== 'true' && result.success !== true) {
    throw new Error('Email was not accepted');
  }
}
