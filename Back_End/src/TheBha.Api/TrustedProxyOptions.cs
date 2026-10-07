using System.Net;
using System.Net.Sockets;
using Microsoft.AspNetCore.HttpOverrides;

namespace TheBha.Api;

/// <summary>
/// CUST-WEB-SHOWCASE-001-CP02: how the API trusts a TLS-terminating reverse proxy (a load balancer or
/// the local nginx). Off by default. When on, <c>X-Forwarded-For</c> and <c>X-Forwarded-Proto</c> are
/// honoured only from the listed proxies, so a request that reaches Kestrel over cleartext from a
/// trusted proxy is treated as HTTPS (Staff cookies stay <c>Secure</c>, the cleartext Admin guard and
/// <c>UseHttpsRedirection</c> see the original scheme) and rate limiting sees the client address.
/// A request from any other peer keeps the socket's own address and scheme, so a spoofed header from
/// a caller that is not a listed proxy changes nothing. No proxy is trusted implicitly: not loopback,
/// not a private range.
/// </summary>
public sealed class TrustedProxyOptions
{
    public const string SectionName = "Hosting:TrustedProxy";

    /// <summary>Narrowest network accepted: wider ranges would trust most of the address space.</summary>
    public const int MinimumIPv4PrefixLength = 8;
    public const int MinimumIPv6PrefixLength = 32;
    public const int MaximumForwardLimit = 5;

    public bool Enabled { get; set; }

    /// <summary>Exact proxy addresses, e.g. the nginx container's fixed address.</summary>
    public string[] KnownProxies { get; set; } = [];

    /// <summary>Proxy networks in CIDR form, e.g. the load balancer subnet.</summary>
    public string[] KnownNetworks { get; set; } = [];

    /// <summary>How many proxies in the chain are trusted; 1 means the single TLS terminator.</summary>
    public int ForwardLimit { get; set; } = 1;

    /// <summary>
    /// Returns the middleware options for an enabled configuration, or <c>null</c> when disabled.
    /// An enabled configuration that is empty, malformed or over-broad stops the host instead of
    /// silently trusting nothing, or everything.
    /// </summary>
    public ForwardedHeadersOptions? Build()
    {
        if (!Enabled)
        {
            return null;
        }

        var proxies = (KnownProxies ?? []).Select(ParseProxy).ToArray();
        var networks = (KnownNetworks ?? []).Select(ParseNetwork).ToArray();
        if (proxies.Length == 0 && networks.Length == 0)
        {
            throw Invalid("it is enabled but lists no KnownProxies or KnownNetworks");
        }

        if (ForwardLimit is < 1 or > MaximumForwardLimit)
        {
            throw Invalid($"ForwardLimit must be between 1 and {MaximumForwardLimit}");
        }

        var options = new ForwardedHeadersOptions
        {
            ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto,
            ForwardLimit = ForwardLimit,
            // The proxy forwards neither Host nor a symmetric header set.
            RequireHeaderSymmetry = false,
        };

        // The framework default trusts loopback; trust exactly what was configured instead.
        options.KnownProxies.Clear();
        options.KnownNetworks.Clear();
        foreach (var proxy in proxies)
        {
            options.KnownProxies.Add(proxy);
        }

        foreach (var network in networks)
        {
            options.KnownNetworks.Add(network);
        }

        return options;
    }

    private static IPAddress ParseProxy(string? value)
    {
        if (!IPAddress.TryParse(value?.Trim(), out var address))
        {
            throw Invalid("KnownProxies must contain IP addresses");
        }

        if (address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any))
        {
            throw Invalid("KnownProxies cannot contain an unspecified address");
        }

        return address;
    }

    private static Microsoft.AspNetCore.HttpOverrides.IPNetwork ParseNetwork(string? value)
    {
        var parts = value?.Trim().Split('/');
        if (parts is not { Length: 2 } ||
            !IPAddress.TryParse(parts[0], out var prefix) ||
            !int.TryParse(parts[1], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var length))
        {
            throw Invalid("KnownNetworks must be CIDR ranges such as 10.0.0.0/16");
        }

        var isV4 = prefix.AddressFamily == AddressFamily.InterNetwork;
        var maxLength = isV4 ? 32 : 128;
        var minLength = isV4 ? MinimumIPv4PrefixLength : MinimumIPv6PrefixLength;
        if (prefix.AddressFamily is not (AddressFamily.InterNetwork or AddressFamily.InterNetworkV6) ||
            prefix.Equals(IPAddress.Any) || prefix.Equals(IPAddress.IPv6Any) ||
            length > maxLength)
        {
            throw Invalid("KnownNetworks must be CIDR ranges such as 10.0.0.0/16");
        }

        if (length < minLength)
        {
            throw Invalid($"a KnownNetworks range wider than /{minLength} is refused");
        }

        return new Microsoft.AspNetCore.HttpOverrides.IPNetwork(prefix, length);
    }

    private static InvalidOperationException Invalid(string reason) =>
        new($"{SectionName} is invalid: {reason}.");
}
