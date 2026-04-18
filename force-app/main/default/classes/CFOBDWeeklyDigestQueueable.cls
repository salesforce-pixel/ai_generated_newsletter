public class CFOBDWeeklyDigestQueueable implements Queueable, Database.AllowsCallouts {

    private Id     digestId;
    private String feedback;
    private String llmUsed;

    public CFOBDWeeklyDigestQueueable(Id digestId) {
        this(digestId, null, null);
    }

    /**
     * @param digestId  The CFO_BD_Weekly_Digest__c record to populate.
     * @param feedback  Optional admin guidance injected into the AI prompt.
     * @param llmUsed   The LLM model used for generating the digest.
     */
    public CFOBDWeeklyDigestQueueable(Id digestId, String feedback, String llmUsed) {
        this.digestId = digestId;
        this.feedback = feedback;
        this.llmUsed = llmUsed;
    }

    public void execute(QueueableContext ctx) {
        System.debug('=== CFOBDWeeklyDigestQueueable: START. Digest Id: ' + digestId);
        String prompt = null; // hoisted so catch block can store it
        System.debug('Job Id: ' + ctx.getJobId());
        if (String.isNotBlank(feedback)) {
            System.debug('Admin feedback provided: ' + feedback);
        }

        try {

            // ── 1. CFO BD Accounts ────────────────────────────────────────
            List<Account> accounts = [
                SELECT Id, Name, Industry, BillingCountry,
                       Description, Website, Type
                FROM   Account
                WHERE  CFO_BD_Account__c = true
                ORDER BY Name
            ];
            System.debug('Accounts found: ' + accounts.size());
            for (Account a : accounts) {
                System.debug('  Account: ' + a.Name + ' | ' + a.BillingCountry);
            }

            if (accounts.isEmpty()) {
                System.debug('No CFO BD accounts found. Aborting.');
                updateDigest(digestId, 'Ready', '{"error":"No CFO BD accounts found"}', null);
                return;
            }

            Set<Id> accountIds = new Map<Id, Account>(accounts).keySet();

            // ── 2. Tasks on Accounts ──────────────────────────────────────
            List<Task> accountTasks = [
                SELECT Id, Subject, Description, ActivityDate, Status,
                       Type, WhatId, WhoId, Owner.Name,
                       What.Name, Who.Name
                FROM   Task
                WHERE  WhatId IN :accountIds
                ORDER BY ActivityDate DESC
            ];
            System.debug('Account Tasks found: ' + accountTasks.size());

            // ── 3. Events on Accounts ─────────────────────────────────────
            List<Event> accountEvents = [
                SELECT Id, Subject, Description, StartDateTime,
                       EndDateTime, Type, WhatId, WhoId, Owner.Name,
                       What.Name, Who.Name, Location
                FROM   Event
                WHERE  WhatId IN :accountIds
                ORDER BY StartDateTime DESC
            ];
            System.debug('Account Events found: ' + accountEvents.size());

            // ── 4. Contacts ───────────────────────────────────────────────
            List<Contact> contacts = [
                SELECT Id, FirstName, LastName, Title,
                       Email, Department, Account.Name
                FROM   Contact
                WHERE  AccountId IN :accountIds
                ORDER BY Account.Name, LastName
            ];
            System.debug('Contacts found: ' + contacts.size());

            // ── 5. Opportunities ──────────────────────────────────────────
            List<Opportunity> opportunities = [
                SELECT Id, Name, StageName, Amount, CloseDate,
                       Type, Description, Probability,
                       Account.Name, Owner.Name, ForecastCategory
                FROM   Opportunity
                WHERE  AccountId IN :accountIds
                ORDER BY Account.Name, CloseDate DESC
            ];
            System.debug('Opportunities found: ' + opportunities.size());
            for (Opportunity o : opportunities) {
                System.debug('  Opp: ' + o.Name + ' | ' + o.StageName + ' | ' + o.Amount);
            }

            Set<Id> oppIds = new Map<Id, Opportunity>(opportunities).keySet();

            // ── 6. Tasks on Opportunities ─────────────────────────────────
            List<Task> oppTasks = new List<Task>();
            if (!oppIds.isEmpty()) {
                oppTasks = [
                    SELECT Id, Subject, Description, ActivityDate,
                           Status, Type, WhatId, WhoId, Owner.Name,
                           What.Name, Who.Name
                    FROM   Task
                    WHERE  WhatId IN :oppIds
                    ORDER BY ActivityDate DESC
                ];
                System.debug('Opportunity Tasks found: ' + oppTasks.size());
            } else {
                System.debug('No opportunities — skipping opp task query.');
            }

            // ── 7. Events on Opportunities ────────────────────────────────
            List<Event> oppEvents = new List<Event>();
            if (!oppIds.isEmpty()) {
                oppEvents = [
                    SELECT Id, Subject, Description, StartDateTime,
                           EndDateTime, Type, WhatId, WhoId, Owner.Name,
                           What.Name, Who.Name
                    FROM   Event
                    WHERE  WhatId IN :oppIds
                    ORDER BY StartDateTime DESC
                ];
                System.debug('Opportunity Events found: ' + oppEvents.size());
            }

            // ── 8. Market Intelligence ────────────────────────────────────
            List<Market_Intelligence__c> marketIntel = [
                SELECT Id, Name, Name__c, Account__c,
                       Account__r.Name, Country_c__c,
                       Region_c__c, Theme_c__c,
                       Impact_c__c, Summary_c__c
                FROM   Market_Intelligence__c
                WHERE  Account__c IN :accountIds
                ORDER BY Account__r.Name
            ];
            System.debug('Market Intelligence records found: ' + marketIntel.size());
            for (Market_Intelligence__c mi : marketIntel) {
                System.debug('  Intel: ' + mi.Name__c
                    + ' | ' + mi.Account__r?.Name
                    + ' | ' + mi.Region_c__c);
            }

            // ── 9. Serialize ──────────────────────────────────────────────
            System.debug('--- Serializing data ---');
            String accountsJson      = serializeAccounts(accounts);
            String accountTasksJson  = serializeTasks(accountTasks);
            String accountEventsJson = serializeEvents(accountEvents);
            String contactsJson      = serializeContacts(contacts);
            String oppsJson          = serializeOpportunities(opportunities);
            String oppTasksJson      = serializeTasks(oppTasks);
            String oppEventsJson     = serializeEvents(oppEvents);
            String intelJson         = serializeMarketIntel(marketIntel);

            System.debug('accountsJson length: '      + accountsJson.length());
            System.debug('accountTasksJson length: '  + accountTasksJson.length());
            System.debug('accountEventsJson length: ' + accountEventsJson.length());
            System.debug('contactsJson length: '      + contactsJson.length());
            System.debug('oppsJson length: '          + oppsJson.length());
            System.debug('oppTasksJson length: '      + oppTasksJson.length());
            System.debug('oppEventsJson length: '     + oppEventsJson.length());
            System.debug('intelJson length: '         + intelJson.length());

            // ── 10. Build prompt ──────────────────────────────────────────
            prompt = buildPrompt(
                accountsJson, accountTasksJson, accountEventsJson,
                contactsJson, oppsJson, oppTasksJson, oppEventsJson,
                intelJson
            );
            System.debug('Total prompt length: ' + prompt.length());
            System.debug('Prompt preview (first 500 chars): ' +
                prompt.substring(0, Math.min(500, prompt.length())));

            // ── 11. Call Models API ───────────────────────────────────────
            System.debug('--- Calling Models API ---');
            String generatedJson = callModelsAPI(prompt, this.llmUsed);
            System.debug('Response length: ' + generatedJson.length());
            System.debug('Response preview (first 500 chars): ' +
                generatedJson.substring(0, Math.min(500, generatedJson.length())));

            // ── 12. Write result ──────────────────────────────────────────
            updateDigest(digestId, 'Ready', generatedJson, prompt);
            System.debug('=== CFOBDWeeklyDigestQueueable: COMPLETE ===');

        } catch (Exception e) {
            System.debug('!!! ERROR: ' + e.getMessage());
            System.debug('!!! Stack trace: ' + e.getStackTraceString());
            updateDigest(digestId, 'Ready',
                '{"error":"' + e.getMessage().replaceAll('"', '\\\\"') + '"}', prompt);
        }
    }


    // ── Serializers ───────────────────────────────────────────────────────

    private static String serializeAccounts(List<Account> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Account a : recs) {
            out.add(new Map<String, Object>{
                'id'          => a.Id,
                'name'        => a.Name,
                'industry'    => a.Industry,
                'country'     => a.BillingCountry,
                'type'        => a.Type,
                'description' => a.Description
            });
        }
        return JSON.serialize(out);
    }

    private static String serializeTasks(List<Task> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Task t : recs) {
            out.add(new Map<String, Object>{
                'subject'    => t.Subject,
                'notes'      => t.Description,
                'date'       => t.ActivityDate,
                'status'     => t.Status,
                'type'       => t.Type,
                'related_to' => t.What?.Name,
                'contact'    => t.Who?.Name,
                'owner'      => t.Owner?.Name
            });
        }
        return JSON.serialize(out);
    }

    private static String serializeEvents(List<Event> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Event e : recs) {
            out.add(new Map<String, Object>{
                'subject'    => e.Subject,
                'notes'      => e.Description,
                'start'      => e.StartDateTime,
                'end'        => e.EndDateTime,
                'type'       => e.Type,
                'related_to' => e.What?.Name,
                'contact'    => e.Who?.Name,
                'owner'      => e.Owner?.Name,
                'location'   => e.Location
            });
        }
        return JSON.serialize(out);
    }

    private static String serializeContacts(List<Contact> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Contact c : recs) {
            out.add(new Map<String, Object>{
                'name'       => c.FirstName + ' ' + c.LastName,
                'title'      => c.Title,
                'department' => c.Department,
                'account'    => c.Account?.Name,
                'email'      => c.Email
            });
        }
        return JSON.serialize(out);
    }

    private static String serializeOpportunities(List<Opportunity> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Opportunity o : recs) {
            out.add(new Map<String, Object>{
                'id'          => o.Id,
                'name'        => o.Name,
                'account'     => o.Account?.Name,
                'stage'       => o.StageName,
                'amount'      => o.Amount,
                'close_date'  => o.CloseDate,
                'probability' => o.Probability,
                'type'        => o.Type,
                'owner'       => o.Owner?.Name,
                'description' => o.Description,
                'forecast'    => o.ForecastCategory
            });
        }
        return JSON.serialize(out);
    }

    private static String serializeMarketIntel(List<Market_Intelligence__c> recs) {
        List<Map<String, Object>> out = new List<Map<String, Object>>();
        for (Market_Intelligence__c mi : recs) {
            out.add(new Map<String, Object>{
                'name'    => mi.Name__c,
                'account' => mi.Account__r?.Name,
                'country' => mi.Country_c__c,
                'region'  => mi.Region_c__c,
                'theme'   => mi.Theme_c__c,
                'impact'  => mi.Impact_c__c,
                'summary' => mi.Summary_c__c
            });
        }
        return JSON.serialize(out);
    }


    // ── Prompt builder ────────────────────────────────────────────────────

    private String buildPrompt(
        String accountsJson, String accountTasksJson, String accountEventsJson,
        String contactsJson, String oppsJson, String oppTasksJson,
        String oppEventsJson, String intelJson
    ) {
        // Inject admin feedback immediately before the RULES block when present
        String feedbackBlock = '';
        if (String.isNotBlank(this.feedback)) {
            feedbackBlock =
                'ADMIN GUIDANCE FOR THIS REGENERATION:\n' +
                this.feedback.trim() + '\n\n';
        }

        return
            'You are an expert Business Development analyst at Equinor, ' +
            'specializing in upstream oil & gas, power, and low carbon solutions. ' +
            'Synthesize the CRM data below into a structured weekly BD intelligence ' +
            'digest for senior leadership.\n\n' +

            feedbackBlock +

            'RULES:\n' +
            '- Respond ONLY with valid JSON. No preamble, no explanation, no markdown fences.\n' +
            '- Follow the JSON schema exactly. Never add or remove keys.\n' +
            '- All summaries: third person, professional, max 2 sentences per item.\n' +
            '- ai_summary: 3-5 sentences on the most strategically significant developments.\n' +
            '- deal_value_usd_bn must be a number, not a string.\n' +
            '- All dates must be ISO 8601 (YYYY-MM-DD).\n' +
            '- If a field has no data use null — never omit the key.\n' +
            '- Region values: Europe, North America, South America, Africa & ME, Asia, Power, Low Carbon Solutions.\n' +
            '- Funnel stage values: New Idea, Screening, Assessment, DGA.\n' +
            '- Channel values: Meeting, Teams, Call.\n\n' +

            'OUTPUT JSON SCHEMA:\n' +
            '{\n' +
            '  "digest": {\n' +
            '    "meta": { "week_label": "string", "week_number": integer, "year": integer, "date_generated": "YYYY-MM-DD" },\n' +
            '    "headline_stats": { "total_engagements": integer, "new_opportunities": integer, "pipeline_value_label": "string", "active_regions": integer },\n' +
            '    "ai_summary": "string",\n' +
            '    "key_intelligence": [{ "region": "string", "sub_sector": "string", "company": "string", "account_id": "string", "summary": "string", "deal_type": "string", "assigned_reps": ["string"] }],\n' +
            '    "deals_of_week": [{ "acquirer": "string", "target": "string", "geography": "string", "sector": "string", "deal_type": "string", "deal_value_usd_bn": number, "deal_value_label": "string", "price_metric": "string", "commentary": "string" }],\n' +
            '    "dga_outlook": [{ "project_code": "string", "deal_type": "string", "geography": "string", "stage": "string" }],\n' +
            '    "funnel_projects": [{ "project_code": "string", "stage": "string", "region": "string", "country": "string", "deal_type": "string", "lead": "string" }],\n' +
            '    "external_engagements": {\n' +
            '      "current_week": [{ "date": "YYYY-MM-DD", "company": "string", "account_id": "string", "contacts": ["string"], "region": "string", "channel": "string", "bd_rep": "string" }],\n' +
            '      "coming_week":  [{ "date": "YYYY-MM-DD", "company": "string", "account_id": "string", "contacts": ["string"], "region": "string", "channel": "string", "bd_rep": "string" }]\n' +
            '    }\n' +
            '  }\n' +
            '}\n\n' +

            '--- CFO BD ACCOUNTS ---\n' + accountsJson + '\n\n' +
            '--- TASKS ON ACCOUNTS ---\n' + accountTasksJson + '\n\n' +
            '--- EVENTS ON ACCOUNTS ---\n' + accountEventsJson + '\n\n' +
            '--- CONTACTS ---\n' + contactsJson + '\n\n' +
            '--- OPPORTUNITIES ---\n' + oppsJson + '\n\n' +
            '--- TASKS ON OPPORTUNITIES ---\n' + oppTasksJson + '\n\n' +
            '--- EVENTS ON OPPORTUNITIES ---\n' + oppEventsJson + '\n\n' +
            '--- MARKET INTELLIGENCE ---\n' + intelJson + '\n\n' +

            'Now produce the weekly digest JSON.';
    }


    // ── Models API callout ────────────────────────────────────────────────

    private static String callModelsAPI(String prompt, String llmUsed) {
        aiplatform.ModelsAPI.createGenerations_Request request =
            new aiplatform.ModelsAPI.createGenerations_Request();

        request.modelName = String.isNotBlank(llmUsed)  ? llmUsed : 'sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet';

        aiplatform.ModelsAPI_GenerationRequest requestBody =
            new aiplatform.ModelsAPI_GenerationRequest();
        requestBody.prompt = prompt;
        request.body = requestBody;

        try {
            aiplatform.ModelsAPI modelsAPI = new aiplatform.ModelsAPI();
            aiplatform.ModelsAPI.createGenerations_Response response =
                modelsAPI.createGenerations(request);

            String raw = response.Code200.generation.generatedText;
            System.debug('Raw Models API response: ' + raw);

            raw = raw.trim();
            if (raw.startsWith('```')) {
                raw = raw.replaceFirst('(?s)```json\\s*', '')
                         .replaceFirst('(?s)```\\s*$', '')
                         .trim();
            }

            // Validate it is parseable before storing
            JSON.deserializeUntyped(raw);
            System.debug('JSON validation passed.');

            return raw;

        } catch (aiplatform.ModelsAPI.createGenerations_ResponseException e) {
            System.debug('!!! Models API ResponseException. Code: ' + e.responseCode);
            System.debug('!!! Exception: ' + e);
            throw new CalloutException(
                'Models API failed [' + e.responseCode + ']: ' + e.getMessage());
        }
    }


    // ── Write back ────────────────────────────────────────────────────────

    private static void updateDigest(Id digestId, String status, String jsonBody, String promptUsed) {
        update new CFO_BD_Weekly_Digest__c(
            Id                    = digestId,
            Status__c             = status,
            Full_JSON_Analysis__c = jsonBody,
            AI_Prompt_Used__c     = promptUsed
        );
        System.debug('Digest updated. Status: ' + status
            + ' | JSON length: ' + jsonBody.length());
    }
}