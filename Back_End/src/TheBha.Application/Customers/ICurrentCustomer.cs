namespace TheBha.Application.Customers;

public interface ICurrentCustomer
{
    bool IsAuthenticated { get; }
    Guid? CustomerAccountId { get; }
    string? Email { get; }
}
