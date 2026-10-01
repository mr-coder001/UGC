/**
 * Passport Authentication Configuration - Google OAuth 2.0
 * Smart UGC Moderation & Asset Studio
 */

const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require('../db/database');

function configurePassport() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const callbackUrl = process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback';

  const isConfigured = Boolean(
    googleClientId &&
    googleClientId !== 'your_google_client_id' &&
    googleClientSecret &&
    googleClientSecret !== 'your_google_client_secret'
  );

  if (isConfigured) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: callbackUrl,
          proxy: true
        },
        async (accessToken, refreshToken, profile, done) => {
          try {
            const googleId = profile.id;
            const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || `${googleId}@google.com`;
            const name = profile.displayName || (profile.name ? `${profile.name.givenName || ''} ${profile.name.familyName || ''}`.trim() : 'Google User');
            const profileImage = (profile.photos && profile.photos[0] && profile.photos[0].value) || '';

            // Check if user already exists
            let user = await db.findUserByGoogleId(googleId);

            if (user) {
              // Update last login and profile info
              user = await db.updateUserLastLogin(user.id, { name, profileImage });
            } else {
              // Create new user record
              user = await db.createUser({
                googleId,
                email,
                name,
                profileImage
              });
            }

            return done(null, user);
          } catch (err) {
            console.error('[Passport Google Auth Error]:', err);
            return done(err, null);
          }
        }
      )
    );
    console.log('[Auth] Google OAuth 2.0 strategy registered successfully.');
  } else {
    console.warn('[Auth Notice] Google OAuth credentials (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET) not set in .env. Configure them to enable Google Sign-In.');
  }

  // Passport Session Serialization
  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await db.findUserById(id);
      if (!user) {
        return done(null, false);
      }
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  return {
    isGoogleConfigured: () => isConfigured
  };
}

module.exports = {
  configurePassport
};
