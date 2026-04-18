# AI Powered Weekly Digest

An AI-powered Salesforce Lightning Web Component that synthesises CRM activity across CFO BD accounts into a structured weekly intelligence digest — automatically generated, reviewed, and published by the BD team.

---

## What This Solution Does

The **Weekly Digest** is a full-stack Salesforce solution consisting of a Lightning Web Component (LWC), three Apex classes, with a scheduled job. It automatically pulls CRM data across tracked accounts and uses an LLM to generate a structured weekly briefing for senior leadership.

1. **Automated data collection** — A scheduled Apex job queries all accounts flagged as CFO BD accounts, pulling associated tasks, events, contacts, opportunities, and market intelligence records from the previous week.
2. **AI-powered synthesis** — The collected CRM data is serialised and sent to Salesforce's Models API (supporting Claude, GPT, and Gemini models). The LLM analyses the data and produces a structured JSON digest covering executive summary, key intelligence, deals of the week, DGA outlook, funnel pipeline, and external engagements.
3. **Admin review workflow** — The generated digest lands in a `Ready` (Awaiting Review) state. Admins can review the full digest across five tabs before publishing it to the wider team.
4. **Manual re-run with model selection** — Admins can trigger a fresh generation at any time, choosing from four supported LLMs (Claude Sonnet 4.6, GPT 5.2, GPT 5.1, Gemini 2.5 Pro) and optionally providing custom guidance that is injected directly into the AI prompt for that run.
5. **Publishing** — Once satisfied, admins publish the digest with a single click, making it visible to all users. The model used for generation is displayed on the digest for transparency.

The component presents the digest across five sections — **Overview**, **Key Intelligence**, **Deals of the Week**, **Pipeline**, and **Engagements** — in a clean editorial interface with a warm ivory and Equinor red design language.

---

## Prerequisites

Ensure the following are in place before deploying:

- **Salesforce CLI (sf CLI):** Latest version
- **Node.js:** Version 18 or higher
- **Git:** For version control
- A Salesforce org with the following features enabled:
  - Einstein AI / Models API (with access to at least one supported model)
  - Salesforce Scheduler (for automated weekly runs)
- The following custom object: **`CFO_BD_Weekly_Digest__c`** with fields:
  - `Status__c` (Picklist: `Generating`, `Ready`, `Published`)
  - `Full_JSON_Analysis__c` (Long Text Area)
  - `Date_Generated__c` (Date)
  - `LLM_Used__c` (Text)
  - `AI_Prompt_Used__c` (Long Text Area)
  - `Job_ID__c` (Text)
- Accounts flagged with `CFO_BD_Account__c` (Checkbox) custom field
- **`Market_Intelligence__c`** custom object with fields: `Name__c`, `Account__c`, `Country_c__c`, `Region_c__c`, `Theme_c__c`, `Impact_c__c`, `Summary_c__c`

---

## Installation

### Step 1: Clone the Repository

```bash
git clone https://github.com/salesforce-pixel/ai_generated_newsletter.git
cd ai_generated_newsletter
```

### Step 2: Authenticate with Your Salesforce Org

```bash
sf org login web -a targetOrg
```

> Replace `targetOrg` with your preferred alias for the org.

### Step 3: Deploy the Project

```bash
sf project deploy start -x manifest/package.xml -o targetOrg -l NoTestRun
```

This deploys all metadata — the LWC (`cfoBDCanvas`), Apex classes (`CFOBDCanvasController`, `CFOBDWeeklyDigestQueueable`, `CFOBDWeeklyDigestScheduler`), and supporting custom labels.

### Step 4: Schedule the Weekly Job

Run the following in **Anonymous Apex** (Developer Console → Execute Anonymous) to schedule automatic weekly generation every Monday at 6am:

```apex
String cronExp = '0 0 6 ? * MON *';
System.schedule('CFO BD Weekly Digest', cronExp, new CFOBDWeeklyDigestScheduler());
```

> To run a one-off generation immediately (e.g. for testing), execute:
> ```apex
> CFOBDWeeklyDigestScheduler.run();
> ```

### Step 5: Add the LWC to a Record Page or App Page

1. Navigate to the page where you want to surface the component (e.g. a Home page or a custom App Page).
2. Click the **Setup** gear → **Edit Page** to open **Lightning App Builder**.
3. Locate **"CFO BD Canvas"** in the component panel on the left.
4. Drag and drop it onto the page in your preferred location.
5. Click **Save** and then **Activate**.

> The component is self-contained and requires no additional page-level configuration beyond placement. Admin functionality (Re-run, Publish) is automatically shown or hidden based on the running user's profile.

---

## Admin Workflow

Once deployed, the weekly digest lifecycle works as follows:

| Step | Who | Action |
|------|-----|--------|
| Generation | Scheduler (automatic) or Admin | Job runs, digest created with status `Generating` |
| Review | Admin | Digest appears as `Awaiting Review` in the date picker |
| Re-run (optional) | Admin | Click **Re-run AI Analysis**, choose LLM, add optional guidance |
| Publish | Admin | Click **Publish** — status flips to `Published`, visible to all users |
| View | All users | Only `Published` digests are visible to non-admins |

---

## Supported LLM Models

The following models can be selected for generation via the Re-run modal or default to Claude Sonnet 4.6 for scheduled runs:

| Label | API Name |
|-------|----------|
| Claude Sonnet 4.6 *(default)* | `sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet` |
| GPT 5.2 | `sfdc_ai__DefaultGPT52` |
| GPT 5.1 | `sfdc_ai__DefaultGPT51` |
| Gemini 2.5 Pro | `sfdc_ai__DefaultVertexAIGeminiPro25` |

---

## Repository Structure

```
force-app/
└── main/
    └── default/
        ├── lwc/
        │   └── cfoBDCanvas/
        │       ├── cfoBDCanvas.html          # Five-tab digest UI template
        │       ├── cfoBDCanvas.js            # Component logic, data enrichment
        │       └── cfoBDCanvas.css           # Light editorial theme
        └── classes/
            ├── CFOBDCanvasController.cls          # AuraEnabled methods: load, publish, trigger
            ├── CFOBDWeeklyDigestQueueable.cls     # Async job: CRM query, prompt build, LLM call
            └── CFOBDWeeklyDigestScheduler.cls     # Scheduler: weekly trigger + manual run
```

---

## Support

For questions or issues, contact [rshekhar@salesforce.com](mailto:rshekhar@salesforce.com)