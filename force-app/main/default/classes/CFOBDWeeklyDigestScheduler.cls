public class CFOBDWeeklyDigestScheduler implements Schedulable {

    public void execute(SchedulableContext sc) {
        run(null, null);
    }

    // Also callable manually from Anonymous Apex for testing
    public static void run() {
        run(null, null);
    }

    /**
     * Enqueues a new digest generation job.
     * @param feedback  Optional admin guidance injected into the AI prompt.
     *                  Pass null or blank when called from the scheduler.
     * @param llmUsed   API name of the LLM to use. Defaults to Claude Sonnet 4.6
     *                  when null/blank.
     */
    public static void run(String feedback, String llmUsed) {
        System.debug('=== CFOBDWeeklyDigestScheduler: START ===');

        Map<String, String> LLM_MAP = new Map<String, String>{
            'sfdc_ai__DefaultGPT52'                            => 'GPT-5.2',
            'sfdc_ai__DefaultGPT51'                            => 'GPT-5.1',
            'sfdc_ai__DefaultBedrockAnthropicClaude46Sonnet'   => 'Claude Sonnet 4.6',
            'sfdc_ai__DefaultVertexAIGeminiPro25'              => 'Gemini 2.5 Pro'
        };

        String resolvedLabel = LLM_MAP.get(llmUsed);

        CFO_BD_Weekly_Digest__c digest = new CFO_BD_Weekly_Digest__c(
            Status__c         = 'Generating',
            Date_Generated__c = Date.today(),
            LLM_Used__c       = resolvedLabel != null ? resolvedLabel : 'Claude Sonnet 4.6'
        );
        insert digest;
        System.debug('Digest record created. Id: ' + digest.Id);

        Id jobId = System.enqueueJob(new CFOBDWeeklyDigestQueueable(digest.Id, feedback, llmUsed));
        System.debug('Queueable enqueued. Job Id: ' + jobId);

        update new CFO_BD_Weekly_Digest__c(
            Id        = digest.Id,
            Job_ID__c = jobId
        );

        System.debug('=== CFOBDWeeklyDigestScheduler: DONE (async job queued) ===');
    }
}