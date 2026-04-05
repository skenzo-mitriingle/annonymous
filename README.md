this is my annonymous

run locally:

1. copy `.env.example` to `.env` and fill in your firebase values
2. start the app with `npm start`
3. open `http://localhost:3000`

note:

- `.env` is ignored by git so the config is no longer hardcoded in `index.html`
- firebase web config is still visible in the browser, so real protection comes from firebase auth and firestore security rules
