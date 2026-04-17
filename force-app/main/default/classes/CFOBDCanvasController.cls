public with sharing class CFOBDCanvasController {

    /**
     * Returns true if the running user has the System Administrator profile.
     */
    @AuraEnabled(cacheable=true)
    public static Boolean isCurrentUserAdmin() {
        User u = [
            SELECT Profile.Name
            FROM   User
            WHERE  Id = :UserInfo.getUserId()
            LIMIT  1
        ];
        return u.Profile.Name == 'System Administrator';
    }

    /**
     * Returns digest dates for the date picker.
     * Admins see Published + Ready digests; non-Admins see Published only.
     * Each map now includes a 'status' key so the JS can track Ready vs Published.
     */
    @AuraEnabled(cacheable=false)
    public static List<Map<String, String>> getDigestDates() {
        Boolean isAdmin = isCurrentUserAdmin();

        List<CFO_BD_Weekly_Digest__c> digests;

        if (isAdmin) {
            digests = [
                SELECT Id, Name, Date_Generated__c, Status__c
                FROM   CFO_BD_Weekly_Digest__c
                WHERE  Status__c IN ('Published', 'Ready')
                ORDER BY Date_Generated__c DESC
                LIMIT  20
            ];
        } else {
            digests = [
                SELECT Id, Name, Date_Generated__c, Status__c
                FROM   CFO_BD_Weekly_Digest__c
                WHERE  Status__c = 'Published'
                ORDER BY Date_Generated__c DESC
                LIMIT  20
            ];
        }

        List<Map<String, String>> result = new List<Map<String, String>>();
        for (CFO_BD_Weekly_Digest__c d : digests) {
            String statusSuffix = d.Status__c == 'Ready' ? ' · Awaiting Review' : '';
            result.add(new Map<String, String>{
                'id'     => d.Id,
                'label'  => d.Name + ' · ' + d.Date_Generated__c.format() + statusSuffix,
                'status' => d.Status__c
            });
        }

        return result;
    }

    /**
     * Returns the Full_JSON_Analysis__c string for a given digest Id.
     * JSON parsing happens in JS — Apex just delivers the raw string.
     */
    @AuraEnabled(cacheable=false)
    public static String getDigestById(Id digestId) {
        CFO_BD_Weekly_Digest__c digest = [
            SELECT Id, Name, Date_Generated__c, Status__c, Full_JSON_Analysis__c
            FROM   CFO_BD_Weekly_Digest__c
            WHERE  Id = :digestId
            LIMIT  1
        ];

        if (String.isBlank(digest.Full_JSON_Analysis__c)) {
            throw new AuraHandledException('Digest has no JSON content yet. Status: ' + digest.Status__c);
        }

        // Inject meta.status into the JSON so LWC can display it
        // We do a lightweight string inject rather than full parse/reserialize
        // to avoid heap bloat on large JSONs
        String json = digest.Full_JSON_Analysis__c;
        String statusInject = '"status":"' + digest.Status__c + '",';

        // Insert after "meta": {
        Integer metaIdx = json.indexOf('"meta"');
        if (metaIdx > -1) {
            Integer braceIdx = json.indexOf('{', metaIdx);
            if (braceIdx > -1) {
                json = json.substring(0, braceIdx + 1) + statusInject + json.substring(braceIdx + 1);
            }
        }

        return json;
    }

    /**
     * Flips a digest's Status__c from Ready to Published.
     * Admin-only action — enforced server-side as well.
     */
    @AuraEnabled
    public static void publishDigest(Id digestId) {
        if (!isCurrentUserAdmin()) {
            throw new AuraHandledException('Only administrators can publish digests.');
        }

        CFO_BD_Weekly_Digest__c digest = [
            SELECT Id, Status__c
            FROM   CFO_BD_Weekly_Digest__c
            WHERE  Id = :digestId
            LIMIT  1
        ];

        if (digest.Status__c != 'Ready') {
            throw new AuraHandledException(
                'Cannot publish digest with status: ' + digest.Status__c + '. Only Ready digests can be published.'
            );
        }

        digest.Status__c = 'Published';
        update digest;
    }

    /**
     * Enqueues a new digest job and returns the job Id.
     * Accepts optional admin feedback to pass through to the prompt.
     */
    @AuraEnabled
    public static String triggerNewDigest(String feedback) {
        try {
            CFOBDWeeklyDigestScheduler.run(feedback);
            return 'Queued successfully';
        } catch (Exception e) {
            throw new AuraHandledException('Failed to queue digest: ' + e.getMessage());
        }
    }
}