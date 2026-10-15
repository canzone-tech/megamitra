// Pure, client-only helpers. Do not persist, log, or send passwords to our backend.
// The WhatsApp message is constructed only after an explicit user gesture.
export type SignupShareDetails = {
  origin: string;
  username: string;
  memberName: string;
  sponsorName: string;
  password: string;
};

export function signupReferralLink(origin: string, username: string): string {
  const id = username.trim();
  if (!id) throw new Error('Member referral code is required');
  const link = new URL('/signup', origin);
  link.searchParams.set('sponsor', id);
  return link.toString();
}

export function signupCredentialMessage(details: SignupShareDetails): string {
  const username = details.username.trim();
  const memberName = details.memberName.trim();
  const sponsorName = details.sponsorName.trim();
  if (!username || !memberName || !sponsorName || !details.password) {
    throw new Error('One-time account details are unavailable');
  }
  const signIn = new URL('/login', details.origin).toString();
  const referralLink = signupReferralLink(details.origin, username);
  return [
    'Welcome to MegaGoldenClub, ' + memberName + '!',
    '',
    'Dear ' + memberName + ',',
    'Your MegaGoldenClub account has been created successfully.',
    '',
    'Member Name: ' + memberName,
    'Sponsor Name: ' + sponsorName,
    'Member Login ID / Referral Code: ' + username,
    'Password: ' + details.password,
    'Login: ' + signIn,
    'Your referral link: ' + referralLink,
    'Keep your password private. Change it after your first sign in.',
  ].join('\n');
}

export function signupWhatsAppShareUrl(details: SignupShareDetails): string {
  return 'https://wa.me/?text=' + encodeURIComponent(signupCredentialMessage(details));
}
