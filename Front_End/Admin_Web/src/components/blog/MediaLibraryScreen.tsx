"use client";

import React, { useState } from "react";
import MediaBrowser from "./MediaBrowser";
import MediaDetailDialog from "./MediaDetailDialog";
import { PageHeader } from "@/components/website/WebsiteUi";
import { useBlogRights } from "./BlogAccessGate";

/** BHA-BLOG-001-CP03: the picture library screen — upload, search, open a picture to edit its details, focal point, see where it is used, or delete it. */
export default function MediaLibraryScreen() {
  const rights = useBlogRights();
  const [openId, setOpenId] = useState<string | null>(null);
  const [token, setToken] = useState(0);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Thư viện ảnh Blog">Ảnh dùng chung cho ảnh bìa, ảnh OG và ảnh trong bài. Thông tin và điểm lấy nét của ảnh không làm đổi bài nào.</PageHeader>
      <MediaBrowser onActivate={(media) => setOpenId(media.id)} canUpload={rights.access} reloadToken={token} />
      {openId && <MediaDetailDialog mediaId={openId} onClose={() => setOpenId(null)} onChanged={() => setToken((n) => n + 1)} />}
    </div>
  );
}
