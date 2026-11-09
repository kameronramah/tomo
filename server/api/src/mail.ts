/**
 * Envoi des e-mails (codes de vérification et de mot de passe oublié) par SMTP.
 * Prévu pour Brevo (gratuit), mais tout serveur SMTP marche.
 *
 * Sans configuration SMTP, rien n'est envoyé : la vérification d'adresse et le mot de passe
 * oublié par e-mail sont simplement indisponibles. En mode dev, les mails sont gardés en
 * mémoire (boîte de test lue par /dev/mailbox) pour les tests automatiques.
 */
import nodemailer from "nodemailer";
import { config } from "./config.js";

/** Envoi possible : SMTP configuré, ou serveur de dev (les mails vont dans la boîte de test). */
export const mailEnabled = () => config.mail !== null || config.devTools;

let transport: nodemailer.Transporter | null = null;
function transporter() {
  if (!config.mail) return null;
  transport ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.port === 465,
    auth: { user: config.mail.user, pass: config.mail.pass },
  });
  return transport;
}

/** Boîte de test (dev seulement) : derniers mails par adresse. */
export const devMailbox = new Map<string, { subject: string; code: string; at: number }>();

export type CodeKind = "verify" | "reset";

const TEXTS: Record<CodeKind, (code: string, username: string) => { subject: string; intro: string; outro: string }> = {
  verify: (code, username) => ({
    subject: `Ton code tomo : ${code}`,
    intro: `Voici le code pour vérifier l'adresse e-mail du compte « ${username} ».`,
    outro: "Il marche 30 minutes. Si tu n'as pas créé de compte tomo, ignore ce mail.",
  }),
  reset: (code, username) => ({
    subject: `Ton code tomo : ${code}`,
    intro: `Quelqu'un (sans doute toi) veut changer le mot de passe du compte « ${username} ».`,
    outro: "Ce code marche 30 minutes. Si ce n'est pas toi, ignore ce mail : ton mot de passe ne change pas.",
  }),
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Envoie un code à 6 chiffres. Ne lève pas d'erreur : renvoie false si l'envoi échoue. */
export async function sendCode(to: string, kind: CodeKind, code: string, username: string): Promise<boolean> {
  const t = TEXTS[kind](code, username);
  if (!config.mail) {
    if (config.devTools) {
      devMailbox.set(to.toLowerCase(), { subject: t.subject, code, at: Date.now() });
      return true;
    }
    return false;
  }
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  try {
    await transporter()!.sendMail({
      from: `tomo <${config.mail.from}>`,
      to,
      subject: t.subject,
      text: `${t.intro}\n\nTon code : ${spaced}\n\n${t.outro}\n\n— tomo`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px;color:#141413">
<p>${esc(t.intro)}</p>
<p style="font-size:28px;font-weight:700;letter-spacing:4px;margin:24px 0">${spaced}</p>
<p style="color:#555">${esc(t.outro)}</p>
<p style="color:#888">— tomo</p></div>`,
    });
    return true;
  } catch (err) {
    console.error("Envoi de mail impossible :", (err as Error).message);
    return false;
  }
}
