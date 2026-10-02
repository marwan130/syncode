namespace server.Models;

public record ChatMessage(
    string Id,
    string Author,
    string Color,
    string Content,
    DateTimeOffset SentAt);
