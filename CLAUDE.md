# CLAUDE.md – feest

Taal: **Nederlands**.

## Werkwijze
Volg `WORKFLOW.md` en `skills/dev-workflow/SKILL.md` uit [flyingwing1994/.github](https://github.com/flyingwing1994/.github): elke wijziging via issue → branch → PR, nooit rechtstreeks naar `main`, Claude merget nooit zelf. Checks en review staan in `.github/workflows/pr.yml`.

## Deze repo
- Node.js zonder externe pakketten; `src/server.js`.
- Nog geen tests (zie het testbasis-issue).
- Draait in Docker op lxc-docker (CT 102, `/opt/feest`, poort 8091); `/beheer` alleen via LAN/Tailscale. `docker-build` staat aan in de checks.
- Geheimen alleen in `.env`, nooit in git.
