# GuardTec backups

`scripts/backup.sh` backs up the database, the document files (`HOST_DATA_PATH`) and `.env`
into `/opt/guardtec-backups`, keeping 14 days.

## One-time setup (on the VPS)

```bash
cd /opt/guardtec && git pull
chmod +x scripts/backup.sh
./scripts/backup.sh            # run once by hand and check the output
ls -lh /opt/guardtec-backups
```

Nightly at 02:30 via cron (`crontab -e`):

```
30 2 * * * /opt/guardtec/scripts/backup.sh >> /var/log/guardtec-backup.log 2>&1
```

## Restore (test this once on a spare machine — an untested backup is not a backup)

```bash
# database
gunzip -c guardtec-DATE-db.sql.gz | docker compose exec -T db psql -U guardtec guardtec
# files
tar -xzf guardtec-DATE-files.tar.gz -C "$(dirname /opt/guardtec-data)"
```

## Important: copy backups OFF the server

Backups on the same VPS disappear with the VPS. Pull them to another machine regularly,
e.g. from your PC (Git Bash):

```bash
scp "root@195.20.232.0:/opt/guardtec-backups/guardtec-*" /path/to/safe/folder/
```

These files contain personal data (vetting, DBS, right-to-work). Keep the copy encrypted
and access-restricted (UK GDPR / BS 7858).
