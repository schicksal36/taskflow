import type { GetStaticProps } from "next";

import { BoardsPageContent } from "@/pages/boards";

export const getStaticProps: GetStaticProps = async () => {
  if (process.env.NODE_ENV === "production") {
    return { notFound: true };
  }

  return { props: {} };
};

export default function FreeBoardPage() {
  return (
    <BoardsPageContent
      allowedTypes={["FREE"]}
      description="자유게시판 글을 등록하고 댓글로 의견과 사진을 공유합니다."
      emptyMessage="조회된 자유게시판 글이 없습니다."
      enableComments
      entityLabel="게시글"
      fixedBoardType="FREE"
      listTitle="자유게시판 목록"
      title="자유게시판"
    />
  );
}
