public class CFOBDWeeklyDigestScheduler implements Schedulable {

    public void execute(SchedulableContext sc) {
        run(null);
    }

    // Also callable manually from Anonymous Apex for testing
    public static void run() {
        run(null);
    }

    /**
     * Enqueues a new digest generation job.
     * @param feedback  Optional admin guidance injected into the AI prompt.
     *                  Pass null or blank when called from the scheduler.
     */
    public static void run(String feedback) {
        System.debug('=== CFOBDWeeklyDigestScheduler: START ===');

        CFO_BD_Weekly_Digest__c digest = new CFO_BD_Weekly_Digest__c(
            Status__c         = 'Generating',
            Date_Generated__c = Date.today()
        );
        insert digest;
        System.debug('Digest record created. Id: ' + digest.Id);

        Id jobId = System.enqueueJob(new CFOBDWeeklyDigestQueueable(digest.Id, feedback));
        System.debug('Queueable enqueued. Job Id: ' + jobId);

        // Optionally store the job Id on the digest for monitoring
        update new CFO_BD_Weekly_Digest__c(
            Id        = digest.Id,
            Job_ID__c = jobId
        );

        System.debug('=== CFOBDWeeklyDigestScheduler: DONE (async job queued) ===');
    }
}