import { BoardsPageContent } from "@/pages/boards";

export default function DataRoomPage() {
  return (
    <BoardsPageContent
      allowedTypes={["DATA_ROOM"]}
      description="자료실 게시글을 등록하고 관리합니다."
      emptyMessage="조회된 자료가 없습니다."
      fixedBoardType="DATA_ROOM"
      listTitle="자료실 목록"
      title="자료실"
    />
  );
}
