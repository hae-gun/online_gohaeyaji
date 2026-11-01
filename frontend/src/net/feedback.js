/**
 * Answer feedback (protocol section 19): what the person sees before agreeing to send.
 * The same masking runs again on the server (AnswerFeedback.mask), so this is only the preview.
 */
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /(?<!\d)0\d{1,2}[ .-]?\d{3,4}[ .-]?\d{4}(?!\d)/g;
const DIGITS = /\d[\d .-]{5,}\d/g;

/** Hides what looks like contact details or ID numbers. */
export function maskContact(text) {
  return text.replace(EMAIL, '[이메일]').replace(PHONE, '[전화번호]').replace(DIGITS, '[숫자]');
}
