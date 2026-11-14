# Company data adapter handoff

`provider.js` is the only file that needs to know how the company's real database works. The chatbot imports the validated gateway from `index.js`; it never receives a database client, credentials, SQL or arbitrary query access.

Implement these three exports in `provider.js`:

- `configured()` — true only when the read-only connection is usable.
- `describe()` — a safe display name, such as `Company reporting database`.
- `getContext({ query, limit })` — search only approved read-only tables/views and normalize at most `limit` records into the documented shape.

The adapter should map the user's question to parameterized, allow-listed queries. Do not concatenate the question into SQL. Return only the fields the assistant is allowed to disclose. `index.js` rejects unsafe URLs, oversized strings, unknown record kinds and more than 25 records.

For invoices, the most useful normalized records are:

- `customer`: name, billing email, billing address and stable customer id;
- `product` / `service`: description and product/service id;
- `pricing`: currency, unit price in minor units and any effective dates;
- `billing` / `order` / `project`: quantity, tax rate, purchase order or project reference when verified.

`profile` is the issuing company's reviewed billing identity. Invoice PDFs are not created unless this profile and complete customer/price evidence are available. The app's MongoDB remains application storage for drafts and audit events; it is not the company data source.
