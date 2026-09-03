# Online Booking NextJs Template: Chisfis

Welcome to **Chisfis**, a responsive Nextjs template theme tailored for Online booking, Listing, Real Estate, and booking systems. Whether you're running an accommodation service, travel experience, cruise, car rental, real estate, or a travel agency, Chisfis has got you covered.

![Chisfis Banner](https://i.ibb.co/JqPfydC/b-landing.png) 

## 🌟 Features

- **Responsive Design**: Modern and fresh design across all devices.
- **Booking & Listing**: Dedicated templates for booking and listing.
- **30+ Pages**: A plethora of pages to suit all your needs.
- **Tailwindcss v3.x**: Built on the latest version for a sleek design.
- **Dark & Light Modes**: Switch between themes seamlessly.
- **Latest Tech Stack**: NextJs 13.4.x (`app` directory), Typescript, and TailwindCss.
- **React Ecosystem**: HeadlessUI components, React v.18.x, Google Map React, React-datepicker, and more.
- **Code Quality**: Proptypes checking, React hooks, and Prettier for a consistent codebase.
- **Interactive Components**: Over 8 listing cards, modal gallery, checkout pages, and more.
- **Built-in React Packages**: A collection of essential packages for a smooth development experience.

## 🔌 Local development: The BHA Hotels API (project-specific)

Supported local topology — **every origin is HTTPS**:

| Component    | Origin                    |
| ------------ | ------------------------- |
| Customer Web | `https://localhost:3000`  |
| Admin Web    | `https://localhost:3001`  |
| API          | `https://localhost:7145`  |

Both Customer Web and the API must be HTTPS. The API issues its antiforgery
cookie as `Secure; SameSite=Lax`, and under the browser's schemeful same-site
rules `http://localhost` and `https://localhost` are *different sites* — so a
Customer page served over HTTP never gets that cookie back on a credentialed
request. CORS and the CSRF token both succeed and the mutation still fails
antiforgery with HTTP 400. Serving both over HTTPS on the same host makes them
same-site (still cross-origin by port) without weakening `SameSite`, `Secure`,
or antiforgery validation. The API also applies `UseHttpsRedirection()`
globally, so `src/lib/api/env.ts` rejects any `http://` API base outright
rather than relying on a redirect a preflight would not follow.

### Setup

1. **Generate a trusted localhost certificate** (once). Using
   [`mkcert`](https://github.com/FiloSottile/mkcert):

   ```bash
   mkcert -install                       # trust the local CA (once per machine)
   mkdir -p .certs
   mkcert -key-file .certs/localhost-key.pem \
          -cert-file .certs/localhost.pem \
          localhost 127.0.0.1 ::1
   ```

   `.certs/` is git-ignored — never commit a certificate or private key.

2. **Install dependencies**:

   ```bash
   npm ci
   ```

3. **Configure the API base**: copy `.env.local.example` to `.env.local` and keep

   ```
   NEXT_PUBLIC_API_BASE_URL=https://localhost:7145
   ```

   It must be `https://`; `http://` (including `http://localhost`) is rejected.
   It must also be a bare origin — URL credentials, a query string and a
   fragment are all rejected.

   > **Every `NEXT_PUBLIC_*` value is compiled into the browser bundle and is
   > readable by anyone who loads the site.** Never put a token, key, password
   > or any other credential in one. A rejected API base is therefore never
   > quoted back in the resulting configuration error — the message names the
   > variable and the violated rule only, so a mistakenly pasted secret does
   > not travel on into a console or a deployment log.

4. **Run the API** on its `https` launch profile (`Back_End/src/TheBha.Api`),
   listening on `https://localhost:7145`.

5. **Start Customer Web over HTTPS**:

   ```bash
   npm run dev        # serves https://localhost:3000 (alias: npm run dev:https)
   ```

The certificate must be genuinely trusted: a browser certificate warning
covers page navigation only, not the background `fetch`/XHR the API client
uses, so an untrusted certificate fails silently. Do not click through
certificate errors when verifying behaviour.

`npm run build` and `npm run start` are unchanged and use the standard Next
commands.

## 📦 In The Box

- Full source code of the theme.
- All React component files.
- CSS & SCSS source codes.
- All plugins & libraries.
- Comprehensive documentation.

## 🚀 Getting Started

1. Clone the repository.
2. Navigate to the `app` directory.
3. Install dependencies using `npm install` or `yarn install`.
4. Run the development server using `npm run dev` or `yarn dev`.
5. Explore the documentation for more details.

## 🙏 Acknowledgements

A big shoutout to all the libraries, plugins, and assets that made this project possible.

---

Crafted with ❤️ by [Hamed Hasan](https://github.com/Hamed-Hasan). Connect with me on [LinkedIn](https://www.linkedin.com/in/hamed-hasan).
