using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Syncode.ExecutionService.Runner;

namespace Syncode.ExecutionService.Queue;

public sealed class ExecutionQueueWorker : BackgroundService
{
    private readonly ExecutionJobQueue _queue;
    private readonly ContainerRunner _runner;
    private readonly ExecutionOutputPublisher _outputPublisher;
    private readonly ILogger<ExecutionQueueWorker> _logger;
    private readonly int _workerCount;

    public ExecutionQueueWorker(
        ExecutionJobQueue queue,
        ContainerRunner runner,
        ExecutionOutputPublisher outputPublisher,
        ILogger<ExecutionQueueWorker> logger,
        int workerCount = 3)
    {
        _queue = queue;
        _runner = runner;
        _outputPublisher = outputPublisher;
        _logger = logger;
        _workerCount = Math.Max(1, workerCount);
    }

    protected override Task ExecuteAsync(CancellationToken stoppingToken) =>
        Task.WhenAll(Enumerable.Range(0, _workerCount).Select(index => RunWorkerAsync(index, stoppingToken)));

    private async Task RunWorkerAsync(int workerNumber, CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            ExecutionJob? job = null;
            try
            {
                job = await _queue.DequeueAsync(stoppingToken);
                if (job is null)
                {
                    await Task.Delay(TimeSpan.FromMilliseconds(250), stoppingToken);
                    continue;
                }

                await _queue.MarkRunningAsync(job);
                _logger.LogInformation("Worker {WorkerNumber} started execution {ExecutionId} for room {RoomId}", workerNumber, job.Id, job.RoomId);

                var result = await _runner.RunAsync(
                    job,
                    async chunk =>
                    {
                        await _queue.AppendOutputAsync(job.Id, chunk);
                        await _outputPublisher.PublishOutputAsync(job, chunk);
                    },
                    stoppingToken);

                await _queue.MarkCompletedAsync(job, result);
                await _outputPublisher.PublishCompletedAsync(job, result);
                _logger.LogInformation(
                    "Execution {ExecutionId} completed with exit code {ExitCode}; timed out: {TimedOut}; output limit exceeded: {OutputLimitExceeded}",
                    job.Id, result.ExitCode, result.TimedOut, result.OutputLimitExceeded);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                if (job is not null)
                {
                    try
                    {
                        await _queue.MarkCancelledAsync(job);
                    }
                    catch (Exception exception)
                    {
                        _logger.LogError(exception, "Could not mark execution {ExecutionId} as cancelled", job.Id);
                    }
                }
                break;
            }
            catch (Exception exception)
            {
                _logger.LogError(exception, "Execution worker {WorkerNumber} failed on job {ExecutionId}", workerNumber, job?.Id ?? "unknown");
                if (job is not null)
                {
                    try
                    {
                        await _queue.MarkFailedAsync(job);
                        await _outputPublisher.PublishFailedAsync(job);
                    }
                    catch (Exception statusException)
                    {
                        _logger.LogError(statusException, "Could not mark execution {ExecutionId} as failed", job.Id);
                    }
                }
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
    }
}
