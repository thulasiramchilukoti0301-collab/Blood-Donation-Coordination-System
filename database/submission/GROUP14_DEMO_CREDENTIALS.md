# Group 14 demo-only login credentials

These fictional credentials are for the isolated schema `group14_blood_donation_demo_20261030` only. They are intentionally public demonstration credentials, stored as bcrypt hashes at work factor 12 in `group14_demo_data.sql`. They are not project, MySQL, application, or personal credentials. Never reuse them outside this demo.

| Role | Demo email | Demo password |
|---|---|---|
| Admin | `admin@group14.demo.invalid` | `Group14-Admin-Demo!2026` |
| Donor | `donor01@group14.demo.invalid` | `Group14-Donor-Demo!2026` |
| Hospital | `hospital01@group14.demo.invalid` | `Group14-Hospital-Demo!2026` |

Demo Donor accounts are `donor01` through `donor12` at `group14.demo.invalid`; they share the listed Donor demo password. Demo Hospital accounts are `hospital01` through `hospital10` at that domain; they share the listed Hospital demo password. Every seeded Account is ACTIVE. The build creates no persistent `app_session` rows; sign-in creates an ordinary session only if the application is separately configured to use this demo schema.

The setup script does not read or edit `backend/.env` and does not repoint a running application. Configure an isolated local application instance deliberately if you later choose to demonstrate logins; do not overwrite the current application configuration as part of database setup.
