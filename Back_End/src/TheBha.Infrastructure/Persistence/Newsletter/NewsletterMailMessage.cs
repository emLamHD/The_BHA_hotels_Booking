using System.Net;
using System.Text;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>The confirmation mail as an RFC 5322 message (UTF-8, base64 parts), already base64url-encoded for Gmail's <c>raw</c> field.</summary>
internal static class NewsletterMailMessage
{
    private sealed record Texts(string Subject, string Heading, string Intro, string Button, string Ignore, string Expires, string Preheader, string Fallback, string Footer);

    private static readonly Dictionary<string, Texts> ByLanguage = new()
    {
        ["vi"] = new("Xác nhận đăng ký nhận tin từ The BHA", "Xác nhận đăng ký", "Bạn (hoặc ai đó dùng địa chỉ này) vừa đăng ký nhận ưu đãi và tin mới từ The BHA. Bấm nút bên dưới để xác nhận.",
            "Xác nhận đăng ký", "Nếu không phải bạn, hãy bỏ qua email này: sẽ không có gì được gửi cho bạn.", "Liên kết có hiệu lực {0} giờ.",
            "Chỉ một bước nữa để nhận ưu đãi và tin mới từ The BHA.", "Nút không hoạt động? Sao chép liên kết này vào trình duyệt:", "Email này được gửi tới {0} vì địa chỉ này đã được dùng để đăng ký nhận tin từ The BHA."),
        ["en"] = new("Confirm your subscription to The BHA news", "Confirm your subscription", "You (or someone using this address) asked to receive offers and news from The BHA. Use the button below to confirm.",
            "Confirm subscription", "If this was not you, ignore this email: nothing will be sent to you.", "The link is valid for {0} hours.",
            "One more step to receive offers and news from The BHA.", "Button not working? Copy this link into your browser:", "This email was sent to {0} because this address was used to subscribe to The BHA news."),
        ["fr"] = new("Confirmez votre inscription aux nouvelles de The BHA", "Confirmez votre inscription", "Vous (ou une personne utilisant cette adresse) avez demandé à recevoir les offres et actualités de The BHA. Utilisez le bouton ci-dessous pour confirmer.",
            "Confirmer l'inscription", "Si ce n'était pas vous, ignorez cet e-mail : rien ne vous sera envoyé.", "Le lien est valable {0} heures.",
            "Plus qu'une étape pour recevoir les offres et actualités de The BHA.", "Le bouton ne fonctionne pas ? Copiez ce lien dans votre navigateur :", "Cet e-mail a été envoyé à {0} car cette adresse a été utilisée pour s'inscrire aux actualités de The BHA.")
    };

    public static string Build(string fromEmail, string fromName, string? replyTo, string toEmail, string language, string confirmUrl, int lifetimeHours, string messageIdHost)
    {
        var t = ByLanguage.GetValueOrDefault(language) ?? ByLanguage["vi"];
        var expires = string.Format(System.Globalization.CultureInfo.InvariantCulture, t.Expires, lifetimeHours);
        var text = $"{t.Heading}\r\n\r\n{t.Intro}\r\n\r\n{confirmUrl}\r\n\r\n{expires}\r\n{t.Ignore}\r\n";
        var html = Html(t, language, expires, confirmUrl, toEmail);
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

    /// <summary>
    /// The HTML part: a 600px centred table with every style inline (Gmail drops most of a head <c>style</c> block), no images (a mail client cannot reach
    /// a localhost or private origin, and many block remote images), a hidden preheader and a button built from a table cell so it renders without CSS.
    /// Every value is HTML-encoded; the confirm link appears verbatim twice (button and copyable fallback).
    /// </summary>
    private static string Html(Texts t, string language, string expires, string confirmUrl, string toEmail)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        var link = E(confirmUrl);
        var lang = ByLanguage.ContainsKey(language) ? language : "vi";
        const string font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
        return "<!doctype html><html lang=\"" + lang + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
               "<meta name=\"color-scheme\" content=\"light\"><meta name=\"supported-color-schemes\" content=\"light\"><title>" + E(t.Subject) + "</title></head>" +
               "<body style=\"margin:0;padding:0;background:#f3f4f8;font-family:" + font + ";\">" +
               // Preheader: the grey preview line in the inbox list; invisible in the message.
               "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f8;font-size:1px;line-height:1px;\">" + E(t.Preheader) + "&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>" +
               "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#f3f4f8\" style=\"background:#f3f4f8;\"><tr><td align=\"center\" style=\"padding:32px 12px;\">" +
               "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:600px;\">" +
               // Brand bar
               "<tr><td align=\"center\" bgcolor=\"#312e81\" style=\"background:#312e81;border-radius:16px 16px 0 0;padding:28px 24px 26px;\">" +
               "<div style=\"font-family:Georgia,'Times New Roman',serif;font-size:28px;line-height:32px;letter-spacing:6px;color:#ffffff;font-weight:bold;\">THE BHA</div>" +
               "<div style=\"margin:12px auto 0;width:48px;height:3px;background:#818cf8;border-radius:2px;font-size:0;line-height:0;\">&nbsp;</div></td></tr>" +
               // Card
               "<tr><td bgcolor=\"#ffffff\" style=\"background:#ffffff;padding:44px 40px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;\" align=\"center\">" +
               "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td align=\"center\" width=\"64\" height=\"64\" bgcolor=\"#eef2ff\" style=\"background:#eef2ff;border-radius:32px;font-size:28px;line-height:64px;color:#4f46e5;\">&#9993;</td></tr></table>" +
               "<h1 style=\"margin:24px 0 12px;font-family:" + font + ";font-size:26px;line-height:34px;color:#111827;font-weight:700;text-align:center;\">" + E(t.Heading) + "</h1>" +
               "<p style=\"margin:0 0 28px;font-family:" + font + ";font-size:16px;line-height:26px;color:#4b5563;text-align:center;\">" + E(t.Intro) + "</p>" +
               // Bulletproof button
               "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td align=\"center\" bgcolor=\"#4f46e5\" style=\"background:#4f46e5;border-radius:10px;\">" +
               "<a href=\"" + link + "\" target=\"_blank\" style=\"display:inline-block;padding:16px 40px;font-family:" + font + ";font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;\">" + E(t.Button) + "</a></td></tr></table>" +
               "<p style=\"margin:20px 0 0;font-family:" + font + ";font-size:13px;line-height:20px;color:#6b7280;text-align:center;\">&#9201;&nbsp;" + E(expires) + "</p>" +
               "<div style=\"margin:32px 0 24px;height:1px;background:#e5e7eb;font-size:0;line-height:0;\">&nbsp;</div>" +
               // Copyable fallback
               "<p style=\"margin:0 0 8px;font-family:" + font + ";font-size:13px;line-height:20px;color:#6b7280;text-align:left;\">" + E(t.Fallback) + "</p>" +
               "<p style=\"margin:0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:18px;color:#4f46e5;word-break:break-all;text-align:left;\"><a href=\"" + link + "\" target=\"_blank\" style=\"color:#4f46e5;text-decoration:none;\">" + link + "</a></p>" +
               "</td></tr>" +
               // Footer
               "<tr><td bgcolor=\"#f9fafb\" style=\"background:#f9fafb;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:24px 40px;\" align=\"center\">" +
               "<p style=\"margin:0 0 8px;font-family:" + font + ";font-size:13px;line-height:20px;color:#374151;text-align:center;\">" + E(t.Ignore) + "</p>" +
               "<p style=\"margin:0;font-family:" + font + ";font-size:12px;line-height:18px;color:#9ca3af;text-align:center;\">" + E(string.Format(System.Globalization.CultureInfo.InvariantCulture, t.Footer, toEmail)) + "</p></td></tr>" +
               "<tr><td align=\"center\" style=\"padding:20px 0 0;font-family:" + font + ";font-size:12px;line-height:18px;color:#9ca3af;\">&copy; " + DateTime.UtcNow.Year.ToString(System.Globalization.CultureInfo.InvariantCulture) + " The BHA</td></tr>" +
               "</table></td></tr></table></body></html>";
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
