# Putting the site online (free)

The site runs on two free services:

| Part | Service | Free plan |
|---|---|---|
| Website and API | [Render](https://render.com) | Sleeps after 15 minutes without visitors; the next visit takes about a minute to wake it |
| MySQL database | [Aiven](https://aiven.io/free-mysql-database) | 1 GB, no expiry, no credit card |

The code goes from **GitHub** to Render, which rebuilds the site automatically every time new code is pushed.

Uploaded course materials are stored in the database, because Render's free plan wipes its own disk on every restart.

---

## 1. Create the database on Aiven

1. Sign up at <https://console.aiven.io/signup> (no credit card needed).
2. Click **Create service**, choose **MySQL**, then the **Free** plan. Pick the region closest to you and click **Create free service**.
3. Wait until the service status says **Running** (a few minutes).
4. On the service's **Overview** page, under **Connection information**:
   - copy the **Service URI**, which starts with `mysql://avnadmin:`;
   - click **CA certificate** and download it (a file called `ca.pem`).

Keep both private: the Service URI contains the database password.

## 2. Put the code on GitHub

1. Sign up at <https://github.com/signup> if you don't have an account.
2. Create a new repository at <https://github.com/new>. Name it `academic-study-support`, set it to **Private**, and don't add a README or licence.
3. Copy the repository's address (`https://github.com/<you>/academic-study-support.git`) and push the code to it. (Claude can do this step for you: just give it the address.)

## 3. Create the website on Render

1. Sign up at <https://dashboard.render.com/register> using **Sign in with GitHub**, and allow Render to see the `academic-study-support` repository.
2. Click **New** → **Blueprint**, and pick the repository. Render reads `render.yaml` and sets up a free web service called `study-support`.
3. Fill in the values it asks for:

   | Setting | What to enter |
   |---|---|
   | `DATABASE_URL` | The Aiven **Service URI** |
   | `DB_SSL_CA` | Open `ca.pem` in Notepad and paste **all** of it, including the `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` lines |
   | `DEMO_PASSWORD` | A password of your choice for every demo account (keep it private) |
   | `ANTHROPIC_API_KEY` | Optional: your Claude API key, to generate concept checks from uploads. Leave blank to turn that off |

   `JWT_SECRET` is generated for you.
4. Click **Apply**. The first build takes about five minutes; you can watch it under **Logs**.
5. When the log says `Server listening`, open the address at the top of the page (something like `https://study-support.onrender.com`).

On its first start the server finds the empty database and creates the tables and demo data itself. Sign in with any demo account from the README, using your `DEMO_PASSWORD`.

## Updating the site

Push new code to GitHub; Render rebuilds and redeploys automatically.

## Things to know

- **The first visit after a quiet spell is slow** (about a minute) while Render wakes the site up. Open it a minute before a demo or presentation.
- **Free limits:** Render allows 750 hours a month, enough to stay up all month; Aiven allows 1 GB, plenty for notes and slides. Aiven may power off a free database after a long period without use; turn it back on from the Aiven console.
- **Question generation is not free:** each concept check generated from an upload is one Claude API call (a few cents), billed to the API key's account.
- **Anyone with the link can register** as a student or peer mentor. Lecturer accounts can't be self-registered.
- **Starting over:** to reset the online database to the demo data, delete and recreate the Aiven database, or ask Claude to run `npm run db:init` against it.

## If something goes wrong

| Problem | Fix |
|---|---|
| Build fails | Open **Logs** on Render; the first red line says what failed. |
| Log says `Could not set up the database` | Check `DATABASE_URL` is the full Service URI, `DB_SSL_CA` contains the whole certificate, and the Aiven service is **Running**. |
| Page says "Can't reach the server" | The site is waking up; wait a minute and refresh. |
| Sign-in says "Too many sign-in attempts" | Wait 15 minutes; this protects accounts from password guessing. |
