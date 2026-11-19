using System.Globalization;
using System.Net;
using System.Text;

namespace TheBha.Infrastructure.Persistence.Newsletter;

/// <summary>
/// The two newsletter mails as RFC 5322 messages (UTF-8, base64 parts), already base64url-encoded for Gmail's <c>raw</c> field: the confirmation that asks the owner of a
/// mailbox to verify it, and the Welcome sent once after the verification. Both share one shell (a 600px table with inline styles, the logo, a photo banner and a footer);
/// the pictures travel inside the message (<c>cid:</c>), so they show without a public origin and without a remote image to block.
/// </summary>
internal static class NewsletterMailMessage
{
    /// <summary>The subject of the Welcome, the same in every language: it is the brand greeting, not a translation.</summary>
    public const string WelcomeSubject = "Welcome to the BHA";

    private const string LogoCid = "bha-logo";
    private const string Font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

    private sealed record Texts(string Subject, string Heading, string Intro, string Button, string Ignore, string Expires, string Preheader, string Fallback, string Footer);

    private sealed record WelcomeTexts(
        string Preheader, string Heading, string Greeting, string Verified, string Welcome, string Cta, string More,
        string OffersTitle, string OffersText, string OffersLink, string RiversideTitle, string RiversideText, string RiversideLink, string NewsTitle, string NewsText, string NewsLink,
        string Why, string Unsubscribe, string UnsubscribeHint);

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

    private static readonly Dictionary<string, WelcomeTexts> WelcomeByLanguage = new()
    {
        ["vi"] = new("Email của bạn đã được xác nhận. Chào mừng bạn đến với The BHA.", "Chào mừng bạn đến với The BHA", "Xin chào,",
            "Email {0} đã được xác nhận thành công.", "Cảm ơn bạn đã đăng ký. Từ nay bạn sẽ là một trong những người đầu tiên biết về ưu đãi lưu trú, câu chuyện từ The BHA Riverside và tin mới của chúng tôi.",
            "Khám phá The BHA", "Có thể bạn muốn xem",
            "Ưu đãi lưu trú", "Các ưu đãi đang áp dụng tại The BHA Riverside.", "Xem ưu đãi",
            "Khám phá The BHA Riverside", "Phòng, tiện nghi và vị trí của chúng tôi.", "Xem chi tiết",
            "Tin mới từ The BHA", "Bài viết và câu chuyện mới nhất từ chúng tôi.", "Đọc tin",
            "Bạn nhận email này vì {0} đã đăng ký nhận tin từ The BHA.", "Hủy nhận tin", "Không muốn nhận email của The BHA nữa?"),
        ["en"] = new("Your email is confirmed. Welcome to The BHA.", "Welcome to The BHA", "Hello,",
            "Your email {0} has been successfully verified.", "Thank you for subscribing. From now on you will be among the first to hear about stay offers, stories from The BHA Riverside and our latest news.",
            "Discover The BHA", "You might want to see",
            "Stay offers", "The offers available now at The BHA Riverside.", "See offers",
            "Discover The BHA Riverside", "Our rooms, amenities and location.", "See details",
            "News from The BHA", "The latest articles and stories from us.", "Read the news",
            "You are receiving this email because {0} subscribed to news from The BHA.", "Unsubscribe", "Do not want to hear from The BHA any more?"),
        ["fr"] = new("Votre e-mail est confirmé. Bienvenue chez The BHA.", "Bienvenue chez The BHA", "Bonjour,",
            "Votre adresse e-mail {0} a bien été confirmée.", "Merci de votre inscription. Vous serez désormais parmi les premiers informés des offres de séjour, des histoires de The BHA Riverside et de nos actualités.",
            "Découvrir The BHA", "Vous aimerez peut-être",
            "Offres de séjour", "Les offres actuellement disponibles à The BHA Riverside.", "Voir les offres",
            "Découvrir The BHA Riverside", "Nos chambres, nos équipements et notre emplacement.", "Voir le détail",
            "Actualités de The BHA", "Nos derniers articles et histoires.", "Lire les actualités",
            "Vous recevez cet e-mail car {0} s'est inscrit aux actualités de The BHA.", "Se désabonner", "Vous ne souhaitez plus recevoir les e-mails de The BHA ?")
    };

    private static readonly Dictionary<string, Lazy<byte[]>> Assets = new[] { "logo.png", "hero.jpg", "welcome-hero.jpg", "card-offers.jpg", "card-riverside.jpg", "card-blog.jpg" }
        .ToDictionary(name => name, name => new Lazy<byte[]>(() => Resource(name)));

    private static byte[] Resource(string name)
    {
        using var stream = typeof(NewsletterMailMessage).Assembly.GetManifestResourceStream("bha-newsletter-mail/" + name)
                           ?? throw new InvalidOperationException($"The mail asset {name} is not embedded in the assembly.");
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    /// <summary>The confirmation mail. The text part holds exactly one <c>https://</c> line, the confirm link.</summary>
    public static string Build(string fromEmail, string fromName, string? replyTo, string toEmail, string language, string confirmUrl, int lifetimeHours, string messageIdHost)
    {
        var t = ByLanguage.GetValueOrDefault(language) ?? ByLanguage["vi"];
        var expires = string.Format(CultureInfo.InvariantCulture, t.Expires, lifetimeHours);
        var text = $"{t.Heading}\r\n\r\n{t.Intro}\r\n\r\n{confirmUrl}\r\n\r\n{expires}\r\n{t.Ignore}\r\n";
        var html = ConfirmationHtml(t, ByLanguage.ContainsKey(language) ? language : "vi", expires, confirmUrl, toEmail);
        return Assemble(fromEmail, fromName, replyTo, toEmail, t.Subject, messageIdHost, text, html, ["logo.png", "hero.jpg"], listUnsubscribe: null);
    }

    /// <summary>
    /// The Welcome. <paramref name="siteOrigin"/> is the Customer https origin the buttons point at; <paramref name="unsubscribeUrl"/> is the one link that leaves the list.
    /// The text part holds exactly one <c>https://</c> line that carries a token (the unsubscribe link); the other links are plain pages of the site.
    /// </summary>
    public static string BuildWelcome(string fromEmail, string fromName, string? replyTo, string toEmail, string language, string siteOrigin, string unsubscribeUrl, string messageIdHost)
    {
        var lang = WelcomeByLanguage.ContainsKey(language) ? language : "vi";
        var t = WelcomeByLanguage[lang];
        var origin = siteOrigin.TrimEnd('/');
        string Url(string path) => origin + path;
        var verified = string.Format(CultureInfo.InvariantCulture, t.Verified, toEmail);
        var why = string.Format(CultureInfo.InvariantCulture, t.Why, toEmail);

        var text = new StringBuilder()
            .Append(t.Heading).Append("\r\n\r\n").Append(t.Greeting).Append("\r\n").Append(verified).Append("\r\n\r\n").Append(t.Welcome).Append("\r\n\r\n")
            .Append(t.Cta).Append(": ").Append(Url("/")).Append("\r\n\r\n").Append(t.More).Append("\r\n\r\n")
            .Append("- ").Append(t.OffersTitle).Append(": ").Append(t.OffersText).Append("\r\n  ").Append(Url("/offers")).Append("\r\n")
            .Append("- ").Append(t.RiversideTitle).Append(": ").Append(t.RiversideText).Append("\r\n  ").Append(Url("/riverside")).Append("\r\n")
            .Append("- ").Append(t.NewsTitle).Append(": ").Append(t.NewsText).Append("\r\n  ").Append(Url("/blog")).Append("\r\n\r\n")
            .Append(why).Append("\r\n").Append(t.UnsubscribeHint).Append("\r\n").Append(unsubscribeUrl).Append("\r\n")
            .ToString();
        var html = WelcomeHtml(t, lang, origin, verified, why, unsubscribeUrl);
        return Assemble(fromEmail, fromName, replyTo, toEmail, WelcomeSubject, messageIdHost, text, html,
            ["logo.png", "welcome-hero.jpg", "card-offers.jpg", "card-riverside.jpg", "card-blog.jpg"], listUnsubscribe: unsubscribeUrl);
    }

    private static string Shell(string lang, string title, string preheader, string heroCid, string inner, string footer)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        return "<!doctype html><html lang=\"" + lang + "\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
               "<meta name=\"color-scheme\" content=\"light\"><meta name=\"supported-color-schemes\" content=\"light\"><title>" + E(title) + "</title>" +
               // Progressive enhancement only: clients that drop a head style still get the fluid 600px layout below.
               "<style>@media only screen and (max-width:480px){.bha-pad{padding-left:20px!important;padding-right:20px!important}.bha-stack{display:block!important;width:100%!important;padding:0!important}" +
               ".bha-stack-img{padding:0 0 12px!important}.bha-h1{font-size:23px!important;line-height:30px!important}}</style></head>" +
               "<body style=\"margin:0;padding:0;background:#f3f4f8;font-family:" + Font + ";\">" +
               // Preheader: the grey preview line in the inbox list; invisible in the message.
               "<div style=\"display:none;max-height:0;overflow:hidden;opacity:0;color:#f3f4f8;font-size:1px;line-height:1px;\">" + E(preheader) + "&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>" +
               "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" bgcolor=\"#f3f4f8\" style=\"background:#f3f4f8;\"><tr><td align=\"center\" style=\"padding:32px 12px;\">" +
               "<table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"width:100%;max-width:600px;\">" +
               // Brand header: the logo on white under a gold rule, then the photo banner.
               "<tr><td align=\"center\" bgcolor=\"#ffffff\" style=\"background:#ffffff;border-radius:16px 16px 0 0;border-top:4px solid #c9973f;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;padding:26px 24px 22px;\">" +
               "<img src=\"cid:" + LogoCid + "\" width=\"200\" alt=\"The BHA Riverside\" style=\"display:block;width:200px;max-width:100%;height:auto;border:0;outline:none;\"></td></tr>" +
               "<tr><td style=\"font-size:0;line-height:0;\"><img src=\"cid:" + heroCid + "\" width=\"600\" alt=\"\" style=\"display:block;width:100%;max-width:600px;height:auto;border:0;outline:none;\"></td></tr>" +
               inner + footer +
               "<tr><td align=\"center\" style=\"padding:20px 0 0;font-family:" + Font + ";font-size:12px;line-height:18px;color:#9ca3af;\">&copy; " + DateTime.UtcNow.Year.ToString(CultureInfo.InvariantCulture) + " The BHA</td></tr>" +
               "</table></td></tr></table></body></html>";
    }

    private static string Button(string href, string label) =>
        "<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td align=\"center\" bgcolor=\"#4f46e5\" style=\"background:#4f46e5;border-radius:10px;\">" +
        "<a href=\"" + href + "\" target=\"_blank\" style=\"display:inline-block;padding:16px 40px;font-family:" + Font + ";font-size:16px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;\">" + WebUtility.HtmlEncode(label) + "</a></td></tr></table>";

    private static string FooterRow(string content) =>
        "<tr><td class=\"bha-pad\" bgcolor=\"#f9fafb\" style=\"background:#f9fafb;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 16px 16px;padding:24px 40px;\" align=\"center\">" + content + "</td></tr>";

    private static string ConfirmationHtml(Texts t, string lang, string expires, string confirmUrl, string toEmail)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        var link = E(confirmUrl);
        var inner =
            "<tr><td class=\"bha-pad\" bgcolor=\"#ffffff\" style=\"background:#ffffff;padding:36px 40px 36px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;\" align=\"center\">" +
            "<h1 class=\"bha-h1\" style=\"margin:0 0 12px;font-family:" + Font + ";font-size:26px;line-height:34px;color:#111827;font-weight:700;text-align:center;\">" + E(t.Heading) + "</h1>" +
            "<p style=\"margin:0 0 28px;font-family:" + Font + ";font-size:16px;line-height:26px;color:#4b5563;text-align:center;\">" + E(t.Intro) + "</p>" +
            Button(link, t.Button) +
            "<p style=\"margin:20px 0 0;font-family:" + Font + ";font-size:13px;line-height:20px;color:#6b7280;text-align:center;\">&#9201;&nbsp;" + E(expires) + "</p>" +
            "<div style=\"margin:32px 0 24px;height:1px;background:#e5e7eb;font-size:0;line-height:0;\">&nbsp;</div>" +
            // Copyable fallback
            "<p style=\"margin:0 0 8px;font-family:" + Font + ";font-size:13px;line-height:20px;color:#6b7280;text-align:left;\">" + E(t.Fallback) + "</p>" +
            "<p style=\"margin:0;padding:12px 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:18px;color:#4f46e5;word-break:break-all;text-align:left;\"><a href=\"" + link + "\" target=\"_blank\" style=\"color:#4f46e5;text-decoration:none;\">" + link + "</a></p>" +
            "</td></tr>";
        var footer = FooterRow(
            "<p style=\"margin:0 0 8px;font-family:" + Font + ";font-size:13px;line-height:20px;color:#374151;text-align:center;\">" + E(t.Ignore) + "</p>" +
            "<p style=\"margin:0;font-family:" + Font + ";font-size:12px;line-height:18px;color:#9ca3af;text-align:center;\">" + E(string.Format(CultureInfo.InvariantCulture, t.Footer, toEmail)) + "</p>");
        return Shell(lang, t.Subject, t.Preheader, "bha-hero", inner, footer);
    }

    private static string WelcomeHtml(WelcomeTexts t, string lang, string origin, string verified, string why, string unsubscribeUrl)
    {
        static string E(string value) => WebUtility.HtmlEncode(value);
        string Card(string cid, string path, string title, string text, string label) =>
            "<tr><td style=\"padding:0 0 18px;\"><table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr>" +
            "<td class=\"bha-stack bha-stack-img\" width=\"168\" valign=\"top\" style=\"width:168px;padding:0 16px 0 0;\">" +
            "<a href=\"" + E(origin + path) + "\" target=\"_blank\"><img src=\"cid:" + cid + "\" width=\"168\" alt=\"" + E(title) + "\" style=\"display:block;width:168px;max-width:100%;height:auto;border:0;border-radius:10px;\"></a></td>" +
            "<td class=\"bha-stack\" valign=\"middle\" style=\"text-align:left;\">" +
            "<div style=\"font-family:" + Font + ";font-size:17px;line-height:24px;font-weight:700;color:#111827;\">" + E(title) + "</div>" +
            "<div style=\"margin:4px 0 8px;font-family:" + Font + ";font-size:14px;line-height:21px;color:#4b5563;\">" + E(text) + "</div>" +
            "<a href=\"" + E(origin + path) + "\" target=\"_blank\" style=\"font-family:" + Font + ";font-size:14px;line-height:20px;font-weight:700;color:#4f46e5;text-decoration:none;\">" + E(label) + " &rarr;</a>" +
            "</td></tr></table></td></tr>";

        var inner =
            "<tr><td class=\"bha-pad\" bgcolor=\"#ffffff\" style=\"background:#ffffff;padding:36px 40px 12px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;\" align=\"left\">" +
            "<h1 class=\"bha-h1\" style=\"margin:0 0 16px;font-family:" + Font + ";font-size:26px;line-height:34px;color:#111827;font-weight:700;text-align:left;\">" + E(t.Heading) + "</h1>" +
            "<p style=\"margin:0 0 6px;font-family:" + Font + ";font-size:16px;line-height:26px;color:#111827;text-align:left;\">" + E(t.Greeting) + "</p>" +
            "<p style=\"margin:0 0 16px;font-family:" + Font + ";font-size:16px;line-height:26px;color:#4b5563;text-align:left;\"><span style=\"color:#15803d;font-weight:700;\">&#10003;</span>&nbsp;" + E(verified) + "</p>" +
            "<p style=\"margin:0 0 28px;font-family:" + Font + ";font-size:16px;line-height:26px;color:#4b5563;text-align:left;\">" + E(t.Welcome) + "</p>" +
            Button(E(origin + "/"), t.Cta) +
            "<div style=\"margin:36px 0 22px;height:1px;background:#e5e7eb;font-size:0;line-height:0;\">&nbsp;</div>" +
            "<p style=\"margin:0 0 18px;font-family:" + Font + ";font-size:13px;line-height:18px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#6b7280;text-align:left;\">" + E(t.More) + "</p>" +
            "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\">" +
            Card("bha-card-offers", "/offers", t.OffersTitle, t.OffersText, t.OffersLink) +
            Card("bha-card-riverside", "/riverside", t.RiversideTitle, t.RiversideText, t.RiversideLink) +
            Card("bha-card-blog", "/blog", t.NewsTitle, t.NewsText, t.NewsLink) +
            "</table></td></tr>";
        var footer = FooterRow(
            "<p style=\"margin:0 0 8px;font-family:" + Font + ";font-size:12px;line-height:18px;color:#6b7280;text-align:center;\">" + E(why) + "</p>" +
            "<p style=\"margin:0;font-family:" + Font + ";font-size:12px;line-height:18px;color:#6b7280;text-align:center;\">" + E(t.UnsubscribeHint) + " " +
            "<a href=\"" + E(unsubscribeUrl) + "\" target=\"_blank\" style=\"color:#4f46e5;text-decoration:underline;\">" + E(t.Unsubscribe) + "</a></p>");
        return Shell(lang, WelcomeSubject, t.Preheader, "bha-welcome-hero", inner, footer);
    }

    /// <summary>
    /// multipart/alternative { text/plain, multipart/related { text/html, inline pictures } }. Every boundary keeps the <c>bha-</c> prefix (the test decoder cuts parts at it).
    /// The picture's Content-ID is <c>bha-</c> and its file name without the extension.
    /// </summary>
    private static string Assemble(string fromEmail, string fromName, string? replyTo, string toEmail, string subject, string messageIdHost, string text, string html, string[] images, string? listUnsubscribe)
    {
        var boundary = "bha-" + Guid.NewGuid().ToString("N");
        var related = "bha-" + Guid.NewGuid().ToString("N");
        var sb = new StringBuilder();
        sb.Append("From: ").Append(Header.Address(fromName, fromEmail)).Append("\r\n");
        sb.Append("To: ").Append(toEmail).Append("\r\n");
        if (!string.IsNullOrEmpty(replyTo)) sb.Append("Reply-To: ").Append(replyTo).Append("\r\n");
        sb.Append("Subject: ").Append(Header.Encode(subject)).Append("\r\n");
        // A mail client shows its own "Unsubscribe" next to the sender when this header is present. The link opens the confirm page; it unsubscribes nothing by itself.
        if (listUnsubscribe is not null) sb.Append("List-Unsubscribe: <").Append(listUnsubscribe).Append(">\r\n");
        sb.Append("Message-ID: <").Append(Guid.NewGuid().ToString("N")).Append('@').Append(messageIdHost).Append(">\r\n");
        sb.Append("MIME-Version: 1.0\r\n");
        sb.Append("Content-Type: multipart/alternative; boundary=\"").Append(boundary).Append("\"\r\n\r\n");
        Part(sb, boundary, "text/plain", text);
        sb.Append("--").Append(boundary).Append("\r\nContent-Type: multipart/related; type=\"text/html\"; boundary=\"").Append(related).Append("\"\r\n\r\n");
        Part(sb, related, "text/html", html);
        foreach (var name in images)
        {
            var id = "bha-" + Path.GetFileNameWithoutExtension(name);
            Image(sb, related, name.EndsWith(".png", StringComparison.Ordinal) ? "image/png" : "image/jpeg", id, name, Assets[name].Value);
        }

        sb.Append("--").Append(related).Append("--\r\n");
        sb.Append("--").Append(boundary).Append("--\r\n");
        return Convert.ToBase64String(Encoding.UTF8.GetBytes(sb.ToString())).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static void Part(StringBuilder sb, string boundary, string type, string body)
    {
        sb.Append("--").Append(boundary).Append("\r\nContent-Type: ").Append(type).Append("; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n");
        Wrapped(sb, Encoding.UTF8.GetBytes(body));
    }

    private static void Image(StringBuilder sb, string boundary, string type, string contentId, string fileName, byte[] bytes)
    {
        sb.Append("--").Append(boundary).Append("\r\nContent-Type: ").Append(type).Append("; name=\"").Append(fileName).Append("\"\r\nContent-Transfer-Encoding: base64\r\n")
          .Append("Content-ID: <").Append(contentId).Append(">\r\nContent-Disposition: inline; filename=\"").Append(fileName).Append("\"\r\n\r\n");
        Wrapped(sb, bytes);
    }

    private static void Wrapped(StringBuilder sb, byte[] bytes)
    {
        var encoded = Convert.ToBase64String(bytes);
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
