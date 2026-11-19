# ΕΣΟΔΑ–ΕΞΟΔΑ (myDATA)

Δική σου, online εφαρμογή για ΕΣΟΔΑ–ΕΞΟΔΑ–ΦΠΑ, με **μία πηγή αλήθειας: το myDATA της ΑΑΔΕ**.
Ανεξάρτητη από τον πάροχο του POS.

- **Έσοδα (εκροές):** `RequestTransmittedDocs` (περιλαμβάνει και τη λιανική μέσω esend)
- **Έξοδα (εισροές):** `RequestDocs` (τιμολόγια προμηθευτών, με επωνυμία από το μητρώο ΑΑΔΕ)

## Αρχιτεκτονική

```
myDATA (AADE)  ──►  Supabase Edge Function (mydata-sync)  ──►  Supabase (Postgres)  ──►  Frontend (GitHub Pages)
   κρυφό κλειδί          κρατάει το ΑΑΔΕ κλειδί                 έσοδα/έξοδα/ΦΠΑ            dashboard (login)
```

Το ΑΑΔΕ κλειδί **δεν** μπαίνει ποτέ στον browser. Τα οικονομικά δεδομένα **δεν** είναι anon-readable — χρειάζεται login.

## 1. Supabase — βάση

1. Νέο project στο [supabase.com](https://supabase.com).
2. SQL Editor → τρέξε όλο το `supabase/schema.sql`.
3. Authentication → Users → πρόσθεσε τον χρήστη σου (email + password) για να μπαίνεις στο dashboard.

## 2. Supabase — Edge Function

Με το [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase link --project-ref <PROJECT_REF>
supabase functions deploy mydata-sync

# Μυστικά (τα δικά σου στοιχεία λήψης myDATA):
supabase secrets set MYDATA_USER_ID="<aade-user-id>"
supabase secrets set MYDATA_KEY="<Ocp-Apim-Subscription-Key>"
supabase secrets set MYDATA_ENV="prod"          # ή "test"
# Προαιρετικά, για επωνυμία προμηθευτή:
supabase secrets set RG_USER="<registry user>"
supabase secrets set RG_PASS="<registry pass>"
```

Δοκιμή συγχρονισμού:
```bash
curl -X POST "https://<PROJECT_REF>.functions.supabase.co/mydata-sync" \
  -H "Authorization: Bearer <ANON_KEY>"
```

### Αυτόματος συγχρονισμός (cron)

Supabase → Database → **Cron** (ή `pg_cron`), π.χ. κάθε ώρα:
```sql
select cron.schedule('mydata-hourly','0 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.functions.supabase.co/mydata-sync',
    headers := '{"Authorization":"Bearer <ANON_KEY>"}'::jsonb
  );
$$);
```

## 3. Frontend — GitHub Pages

1. `cp config.example.js config.js` και βάλε `SUPABASE_URL` + `SUPABASE_ANON_KEY` (Project Settings → API).
2. Push σε GitHub repo, Settings → Pages → Deploy from branch.
3. Άνοιξε τη σελίδα, κάνε login, πάτα **Συγχρονισμός τώρα** (πρώτη φορά τραβάει όλο το ιστορικό — μπορεί να πάρει λίγη ώρα· η Edge Function δουλεύει σε παρτίδες, ξανατρέξέ τη μέχρι `added` = 0).

> Χωρίς `config.js` η σελίδα ανοίγει σε **λειτουργία επίδειξης** με εικονικά νούμερα — για να βλέπεις το στήσιμο.

## Σημειώσεις

- **Λιανική = συγκεντρωτικά:** το myDATA δίνει τη λιανική ως σύνοψη (όχι απόδειξη-απόδειξη). Τα σύνολα/ΦΠΑ είναι σωστά.
- Τα παραστατικά τύπου **8.6** (Δελτίο Παραγγελίας Εστίασης) εξαιρούνται από τα έσοδα (όψη `v_income`) για να μη διπλομετρώνται.
- **Χρεωστικό ΦΠΑ** = ΦΠΑ εκροών − ΦΠΑ εισροών (ενδεικτικό· δεν υποκαθιστά τη δήλωση).
- Το κουμπί «Συγχρονισμός τώρα» καλεί την Edge Function· αν θες να το κλειδώσεις μόνο σε συνδεδεμένους χρήστες, πρόσθεσε έλεγχο JWT στην αρχή της `Deno.serve`.
