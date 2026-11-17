using System.Net;
using System.Text;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>The confirmation mail as an RFC 5322 message (UTF-8, base64 parts), already base64url-encoded for Gmail's <c>raw</c> field.</summary>
internal static class NewsletterMailMessage
{
    private sealed record Texts(string Subject, string Heading, string Intro, string Button, string Ignore, string Expires);

    private static readonly Dictionary<string, Texts> ByLanguage = new()
    {
        ["vi"] = new("Xác nhận đăng ký nhận tin từ The BHA", "Xác nhận đăng ký", "Bạn (hoặc ai đó dùng địa chỉ này) vừa đăng ký nhận ưu đãi và tin mới từ The BHA. Bấm nút bên dưới để xác nhận.",
            "Xác nhận đăng ký", "Nếu không phải bạn, hãy bỏ qua email này: sẽ không có gì được gửi cho bạn.", "Liên kết có hiệu lực {0} giờ."),
        ["en"] = new("Confirm your subscription to The BHA news", "Confirm your subscription", "You (or someone using this address) asked to receive offers and news from The BHA. Use the button below to confirm.",
            "Confirm subscription", "If this was not you, ignore this email: nothing will be sent to you.", "The link is valid for {0} hours."),
        ["fr"] = new("Confirmez votre inscription aux nouvelles de The BHA", "Confirmez votre inscription", "Vous (ou une personne utilisant cette adresse) avez demandé à recevoir les offres et actualités de The BHA. Utilisez le bouton ci-dessous pour confirmer.",
            "Confirmer l'inscription", "Si ce n'était pas vous, ignorez cet e-mail : rien ne vous sera envoyé.", "Le lien est valable {0} heures.")
    };

    public static string Build(string fromEmail, string fromName, string? replyTo, string toEmail, string language, string confirmUrl, int lifetimeHours, string messageIdHost)
    {
        var t = ByLanguage.GetValueOrDefault(language) ?? ByLanguage["vi"];
        var expires = string.Format(System.Globalization.CultureInfo.InvariantCulture, t.Expires, lifetimeHours);
        var text = $"{t.Heading}\r\n\r\n{t.Intro}\r\n\r\n{confirmUrl}\r\n\r\n{expires}\r\n{t.Ignore}\r\n";
        var html = "<!doctype html><html><body style=\"font-family:Arial,sans-serif;color:#1f2937\">" +
                   $"<h2>{WebUtility.HtmlEncode(t.Heading)}</h2><p>{WebUtility.HtmlEncode(t.Intro)}</p>" +
                   $"<p><a href=\"{WebUtility.HtmlEncode(confirmUrl)}\" style=\"background:#4f46e5;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none\">{WebUtility.HtmlEncode(t.Button)}</a></p>" +
                   $"<p style=\"font-size:13px;color:#6b7280\">{WebUtility.HtmlEncode(expires)}<br>{WebUtility.HtmlEncode(t.Ignore)}</p></body></html>";
        var boundary = "bha-" + Guid.NewGuid().ToString("N");
        var sb = new StringBuilder();
        sb.Append("From: ").Append(Header.Address(fromName, fromEmail)).Append("\r\n");
        sb.Append("To: ").Append(toEmail).Append("\r\n");
        if (!string.IsNullOrEmpty(replyTo)) sb.Append("Reply-To: ").Append(replyTo).Append("\r\n");
        sb.Append("Subject: ").Append(Header.Encode(t.Subject)).Append("\r\n");
        sb.Append("Message-ID: <").Append(Guid.NewGuid().ToString("N")).Append('@').Append(messageIdHost).Append(">\r\n");
        sb.Append("MIME-Version: 1.0\r\n");
        sb.Append("Content-Type: multipart/alternative; boundary=\"").Append(boundary).Append("\"\r\n\r\n");
        Part(sb, boundary, "text/plain", text);
        Part(sb, boundary, "text/html", html);
        sb.Append("--").Append(boundary).Append("--\r\n");
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString())).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static void Part(StringBuilder sb, string boundary, string type, string body)
    {
        sb.Append("--").Append(boundary).Append("\r\nContent-Type: ").Append(type).Append("; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
        var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(body));
        for (var i = 0; i < encoded.Length; i += 76) sb.Append(encoded, i, Math.Min(76, encoded.Length - i)).Append("\r\n");
    }

    private static class Header
    {
        // RFC 2047 encoded-word, so a non-ASCII display name or subject survives; the name has no control characters (checked when saved).
        public static string Encode(string value) => value.All(c => c < 128) ? value : "=?UTF-8?B?" + Convert.ToBase64String(Encoding.UTF8.GetBytes(value)) + "?=";

        public static string Address(string name, string email)
        {
            if (string.IsNullOrWhiteSpace(name)) return email;
            // An ASCII name is a quoted string (a comma or a dot in it must not split the address); anything else is an encoded word.
            var display = name.All(c => c < 128) ? "\"" + name.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal) + "\"" : Encode(name);
            return $"{display} <{email}>";
        }
    }
}
