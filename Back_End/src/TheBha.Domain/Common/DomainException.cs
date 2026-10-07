namespace TheBha.Domain.Common;

public sealed class DomainException(string message) : ArgumentException(message);
