# Email setup for dummies (SSH + IONOS on the server)

## 1. SSH into your server

On your PC, open **Command Prompt** (cmd).

Type (replace `root` with your username if you use one):

```
ssh root@178.128.38.68
```

If you use an SSH key file (e.g. from DigitalOcean):

```
ssh -i "C:\Users\jakeg\.ssh\your_private_key" root@178.128.38.68
```

- First time: type **yes** when it asks "Are you sure you want to continue connecting?"
- When it asks for a password, type your server login password (or use the key so it doesn’t ask).

When you see something like `root@your-server-name:~#`, you’re **on the server**.

---

## 2. Find the app folder and open .env

The game app is probably in a folder like `/var/www/mafia` or `~/mafia`. Change into it, then edit `.env`:

```
cd /var/www/mafia
```

If you’re not sure where the app is:

```
find / -name ".env" -path "*mafia*" 2>/dev/null
```

Then open the `.env` file with nano:

```
nano .env
```

---

## 3. Add or edit the email (SMTP) lines

In nano, scroll to the **EMAIL** section (or the end of the file). Add or change these lines. Use your real IONOS mailbox password.

```
SMTP_HOST=smtp.ionos.co.uk
SMTP_PORT=587
SMTP_USER=admin@mafiawars.co.uk
SMTP_PASSWORD=your_actual_mailbox_password_here
MAIL_FROM="Mafia Wars <admin@mafiawars.co.uk>"
FRONTEND_URL=https://mafiawars.co.uk
```

- Replace `your_actual_mailbox_password_here` with the real password for **admin@mafiawars.co.uk**.
- If you use **www** in your site URL, use `https://www.mafiawars.co.uk` for `FRONTEND_URL` instead.
- Leave `RESEND_API_KEY` empty (or delete it) if you’re only using IONOS.

**Nano shortcuts:**

- **Save:** Ctrl+O, then press Enter  
- **Exit:** Ctrl+X  

---

## 4. Restart the app so it loads the new .env

If you run the backend with **systemd** (e.g. a service called `mafia` or `backend`):

```
sudo systemctl restart mafia
```

If you use **PM2**:

```
pm2 restart all
```

If you run it some other way, stop the process and start it again so it rereads `.env`.

---

## 5. Test

- Register a new account with an email you can check.
- You should get a verification email from **admin@mafiawars.co.uk**.
- If nothing arrives, check the server logs (e.g. `sudo journalctl -u mafia -f` or `pm2 logs`) for SMTP errors.

---

## Quick reference

| Step            | Command / action |
|-----------------|------------------|
| Open terminal   | Command Prompt (cmd) |
| SSH in          | `ssh root@178.128.38.68` |
| Go to app       | `cd /var/www/mafia` (or your app path) |
| Edit .env       | `nano .env` |
| Save in nano    | Ctrl+O, Enter |
| Quit nano       | Ctrl+X |
| Restart service | `sudo systemctl restart mafia` or `pm2 restart all` |
